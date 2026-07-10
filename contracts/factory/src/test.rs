#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env, String,
};

const DAY: u64 = 86_400;

/// Exactly `MAX_TITLE_LEN` characters, and one past it.
const TITLE_AT_LIMIT: &str = "0123456789012345678901234567890123456789012345678901234567890123";
const TITLE_OVER_LIMIT: &str = "01234567890123456789012345678901234567890123456789012345678901234";

struct Setup {
    env: Env,
    factory: FactoryClient<'static>,
    token: token::TokenClient<'static>,
    admin: Address,
    alice: Address,
    bob: Address,
    deadline: u64,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());

    // The factory can only deploy wasm the ledger already knows about.
    let wasm_hash = env.deployer().upload_contract_wasm(campaign::WASM);
    let id = env.register(Factory, (admin.clone(), sac.address(), wasm_hash));

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let mint = token::StellarAssetClient::new(&env, &sac.address());
    mint.mint(&alice, &1_000);
    mint.mint(&bob, &1_000);

    Setup {
        factory: FactoryClient::new(&env, &id),
        token: token::TokenClient::new(&env, &sac.address()),
        deadline: env.ledger().timestamp() + 7 * DAY,
        env,
        admin,
        alice,
        bob,
    }
}

fn title(env: &Env, text: &str) -> String {
    String::from_str(env, text)
}

#[test]
fn create_deploys_a_live_campaign_contract() {
    let s = setup();

    let address = s
        .factory
        .create(&s.alice, &title(&s.env, "Fund the docs"), &500, &s.deadline);

    assert!(s.factory.is_campaign(&address));
    assert_eq!(
        s.factory.campaigns(),
        soroban_sdk::vec![&s.env, address.clone()]
    );

    // The deployed contract is a real, independently callable campaign.
    let state = campaign::Client::new(&s.env, &address).state();
    assert_eq!(state.title, title(&s.env, "Fund the docs"));
    assert_eq!(state.recipient, s.alice);
    assert_eq!(state.goal, 500);
    assert_eq!(state.deadline, s.deadline);
    assert_eq!(state.raised, 0);
}

#[test]
fn each_campaign_gets_its_own_address_even_from_one_creator() {
    let s = setup();

    let first = s
        .factory
        .create(&s.alice, &title(&s.env, "One"), &100, &s.deadline);
    let second = s
        .factory
        .create(&s.alice, &title(&s.env, "Two"), &200, &s.deadline);
    let third = s
        .factory
        .create(&s.bob, &title(&s.env, "Three"), &300, &s.deadline);

    assert_ne!(first, second);
    assert_ne!(second, third);
    assert_eq!(s.factory.campaigns().len(), 3);
}

/// The whole point of the factory: money flows through a campaign it deployed,
/// and the campaign in turn calls the token contract.
#[test]
fn a_deployed_campaign_escrows_contributions() {
    let s = setup();
    let address = s
        .factory
        .create(&s.alice, &title(&s.env, "Fund the docs"), &500, &s.deadline);
    let campaign = campaign::Client::new(&s.env, &address);

    campaign.contribute(&s.bob, &120);

    assert_eq!(campaign.state().raised, 120);
    assert_eq!(
        s.token.balance(&address),
        120,
        "token escrowed in the campaign"
    );
    assert_eq!(s.token.balance(&s.bob), 880);
}

#[test]
fn listing_reads_state_from_every_campaign() {
    let s = setup();
    let first = s
        .factory
        .create(&s.alice, &title(&s.env, "One"), &100, &s.deadline);
    let second = s
        .factory
        .create(&s.bob, &title(&s.env, "Two"), &400, &s.deadline);

    campaign::Client::new(&s.env, &first).contribute(&s.bob, &60);

    let rows = s.factory.listing(&0, &10);
    assert_eq!(rows.len(), 2);

    let one = rows.get(0).unwrap();
    assert_eq!(one.address, first);
    assert_eq!(one.title, title(&s.env, "One"));
    assert_eq!(one.creator, s.alice);
    assert_eq!(one.raised, 60);
    assert_eq!(one.contributors, 1);

    let two = rows.get(1).unwrap();
    assert_eq!(two.address, second);
    assert_eq!(two.raised, 0);
}

#[test]
fn listing_pages_through_campaigns() {
    let s = setup();
    for index in 0..3 {
        s.factory.create(
            &s.alice,
            &title(&s.env, "Campaign"),
            &(100 * (index + 1)),
            &s.deadline,
        );
    }

    assert_eq!(s.factory.listing(&0, &2).len(), 2);
    assert_eq!(s.factory.listing(&2, &2).len(), 1, "clamped to what exists");
    assert_eq!(s.factory.listing(&3, &2).len(), 0, "past the end");
    assert_eq!(s.factory.listing(&0, &99).len(), 3);
}

#[test]
fn stats_aggregate_across_campaigns() {
    let s = setup();
    let first = s
        .factory
        .create(&s.alice, &title(&s.env, "One"), &100, &s.deadline);
    let second = s
        .factory
        .create(&s.bob, &title(&s.env, "Two"), &400, &s.deadline);

    // Fully fund the first, partially fund the second.
    campaign::Client::new(&s.env, &first).contribute(&s.bob, &100);
    campaign::Client::new(&s.env, &second).contribute(&s.alice, &50);

    let stats = s.factory.stats();
    assert_eq!(stats.campaigns, 2);
    assert_eq!(stats.aggregated, 2);
    assert_eq!(stats.total_raised, 150);
    assert_eq!(stats.total_goal, 500);
    assert_eq!(stats.funded, 1, "only the first reached its goal");
}

#[test]
fn stats_on_an_empty_factory_are_zero() {
    let s = setup();
    let stats = s.factory.stats();
    assert_eq!(stats.campaigns, 0);
    assert_eq!(stats.aggregated, 0);
    assert_eq!(stats.total_raised, 0);
    assert_eq!(stats.funded, 0);
}

#[test]
fn is_campaign_rejects_addresses_the_factory_did_not_deploy() {
    let s = setup();
    s.factory
        .create(&s.alice, &title(&s.env, "One"), &100, &s.deadline);
    assert!(!s.factory.is_campaign(&Address::generate(&s.env)));
}

#[test]
fn create_validates_its_arguments() {
    let s = setup();

    assert_eq!(
        s.factory
            .try_create(&s.alice, &title(&s.env, ""), &100, &s.deadline),
        Err(Ok(Error::TitleEmpty))
    );
    assert_eq!(
        s.factory.try_create(
            &s.alice,
            &title(&s.env, TITLE_OVER_LIMIT),
            &100,
            &s.deadline
        ),
        Err(Ok(Error::TitleTooLong))
    );
    assert_eq!(
        s.factory
            .try_create(&s.alice, &title(&s.env, "Zero"), &0, &s.deadline),
        Err(Ok(Error::InvalidGoal))
    );
    assert_eq!(
        s.factory
            .try_create(&s.alice, &title(&s.env, "Past"), &100, &999u64),
        Err(Ok(Error::InvalidDeadline))
    );

    assert_eq!(s.factory.campaigns().len(), 0, "nothing was deployed");
}

#[test]
fn create_accepts_a_title_at_the_length_limit() {
    let s = setup();
    s.factory
        .create(&s.alice, &title(&s.env, TITLE_AT_LIMIT), &100, &s.deadline);
    assert_eq!(s.factory.campaigns().len(), 1);
}

/// Existing campaigns keep the code they were deployed with; only new ones
/// follow the pointer. Deploying from a hash the ledger has never seen must
/// fail, which is what proves `create` really reads the updated config.
#[test]
fn set_campaign_wasm_redirects_future_deployments() {
    let s = setup();
    let first = s
        .factory
        .create(&s.alice, &title(&s.env, "Before"), &100, &s.deadline);

    let unknown_wasm = BytesN::from_array(&s.env, &[7u8; 32]);
    s.factory.set_campaign_wasm(&unknown_wasm);
    assert_eq!(s.factory.config().campaign_wasm, unknown_wasm);
    assert_eq!(s.factory.config().admin, s.admin);

    assert!(
        s.factory
            .try_create(&s.alice, &title(&s.env, "After"), &100, &s.deadline)
            .is_err(),
        "cannot deploy wasm the ledger does not have"
    );
    assert_eq!(
        s.factory.campaigns(),
        soroban_sdk::vec![&s.env, first],
        "the failed create registered nothing"
    );
}

#[test]
fn set_campaign_wasm_requires_the_admin_to_sign() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    // No mock_all_auths: a stranger must not be able to redirect deployments.
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let wasm_hash = env.deployer().upload_contract_wasm(campaign::WASM);
    let id = env.register(Factory, (admin, sac.address(), wasm_hash.clone()));
    let factory = FactoryClient::new(&env, &id);

    assert!(factory
        .try_set_campaign_wasm(&BytesN::from_array(&env, &[7u8; 32]))
        .is_err());
    assert_eq!(factory.config().campaign_wasm, wasm_hash);
}

#[test]
fn create_requires_the_creator_to_sign() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    // No mock_all_auths: an unsigned create must not deploy anything.
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let wasm_hash = env.deployer().upload_contract_wasm(campaign::WASM);
    let id = env.register(Factory, (admin, sac.address(), wasm_hash));
    let factory = FactoryClient::new(&env, &id);

    let deadline = env.ledger().timestamp() + DAY;
    assert!(factory
        .try_create(
            &Address::generate(&env),
            &String::from_str(&env, "Unsigned"),
            &100,
            &deadline
        )
        .is_err());
    assert_eq!(factory.campaigns().len(), 0);
}
