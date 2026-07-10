#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, vec, Address, Env, Event, IntoVal, String, Symbol,
};

const DAY: u64 = 86_400;

struct Setup {
    env: Env,
    contract: CampaignClient<'static>,
    token: token::TokenClient<'static>,
    recipient: Address,
    alice: Address,
    bob: Address,
    deadline: u64,
}

fn setup(goal: i128) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = token::TokenClient::new(&env, &sac.address());
    let mint = token::StellarAssetClient::new(&env, &sac.address());

    let recipient = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint.mint(&alice, &1_000);
    mint.mint(&bob, &1_000);

    let deadline = env.ledger().timestamp() + 7 * DAY;
    let id = env.register(
        Campaign,
        (
            sac.address(),
            recipient.clone(),
            String::from_str(&env, "Open Source Fund"),
            goal,
            deadline,
        ),
    );

    Setup {
        contract: CampaignClient::new(&env, &id),
        env,
        token,
        recipient,
        alice,
        bob,
        deadline,
    }
}

#[test]
fn state_reports_the_title_and_terms_it_was_created_with() {
    let s = setup(500);
    let state = s.contract.state();

    assert_eq!(state.title, String::from_str(&s.env, "Open Source Fund"));
    assert_eq!(state.goal, 500);
    assert_eq!(state.deadline, s.deadline);
    assert_eq!(state.raised, 0);
    assert!(!state.withdrawn);
}

#[test]
fn contribute_accumulates_and_counts_unique_contributors() {
    let s = setup(500);

    assert_eq!(s.contract.contribute(&s.alice, &100), 100);
    assert_eq!(s.contract.contribute(&s.bob, &50), 150);
    assert_eq!(s.contract.contribute(&s.alice, &25), 175);

    let state = s.contract.state();
    assert_eq!(state.raised, 175);
    assert_eq!(state.contributors, 2, "alice contributing twice counts once");
    assert_eq!(s.contract.contribution(&s.alice), 125);
    assert_eq!(s.contract.contribution(&s.bob), 50);

    // Money actually moved into the contract.
    assert_eq!(s.token.balance(&s.contract.address), 175);
    assert_eq!(s.token.balance(&s.alice), 875);
}

/// The frontend's live progress bar is driven entirely by these events, so the
/// topic shape is part of the contract's public surface.
#[test]
fn contribute_emits_contributed_event_the_frontend_can_index() {
    let s = setup(500);
    s.contract.contribute(&s.alice, &100);

    let expected = Contributed {
        contributor: s.alice.clone(),
        amount: 100,
        raised: 100,
    };
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.contract.address),
        vec![
            &s.env,
            (
                s.contract.address.clone(),
                expected.topics(&s.env),
                expected.data(&s.env)
            )
        ]
    );

    // Pin the topics the frontend subscribes to; renaming them breaks the UI.
    assert_eq!(
        expected.topics(&s.env),
        vec![
            &s.env,
            Symbol::new(&s.env, "contributed").into_val(&s.env),
            s.alice.into_val(&s.env)
        ]
    );
}

#[test]
fn contribute_rejects_non_positive_amounts() {
    let s = setup(500);
    assert_eq!(
        s.contract.try_contribute(&s.alice, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.contract.try_contribute(&s.alice, &-5),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn contribute_rejects_after_deadline() {
    let s = setup(500);
    s.env.ledger().set_timestamp(s.deadline);
    assert_eq!(
        s.contract.try_contribute(&s.alice, &100),
        Err(Ok(Error::CampaignEnded))
    );
}

#[test]
fn contribute_fails_when_contributor_is_short_on_funds() {
    let s = setup(500);
    // Alice holds 1_000; asking for more must abort the whole call.
    assert!(s.contract.try_contribute(&s.alice, &1_001).is_err());
    assert_eq!(s.contract.state().raised, 0);
}

#[test]
fn withdraw_pays_recipient_once_goal_met_after_deadline() {
    let s = setup(150);
    s.contract.contribute(&s.alice, &100);
    s.contract.contribute(&s.bob, &50);

    // Still running: recipient must wait.
    assert_eq!(s.contract.try_withdraw(), Err(Ok(Error::CampaignActive)));

    s.env.ledger().set_timestamp(s.deadline);
    assert_eq!(s.contract.withdraw(), 150);
    assert_eq!(s.token.balance(&s.recipient), 150);
    assert_eq!(s.token.balance(&s.contract.address), 0);
    assert!(s.contract.state().withdrawn);

    assert_eq!(s.contract.try_withdraw(), Err(Ok(Error::AlreadyWithdrawn)));
}

#[test]
fn withdraw_blocked_when_goal_missed() {
    let s = setup(500);
    s.contract.contribute(&s.alice, &100);
    s.env.ledger().set_timestamp(s.deadline);
    assert_eq!(s.contract.try_withdraw(), Err(Ok(Error::GoalNotMet)));
}

#[test]
fn refund_returns_money_after_failed_campaign() {
    let s = setup(500);
    s.contract.contribute(&s.alice, &100);
    s.contract.contribute(&s.bob, &50);

    // Cannot bail out while the campaign is still live.
    assert_eq!(
        s.contract.try_refund(&s.alice),
        Err(Ok(Error::CampaignActive))
    );

    s.env.ledger().set_timestamp(s.deadline);
    assert_eq!(s.contract.refund(&s.alice), 100);
    assert_eq!(s.token.balance(&s.alice), 1_000);
    assert_eq!(s.contract.contribution(&s.alice), 0);
    assert_eq!(s.contract.state().raised, 50, "only bob's money is left");

    // No double refund, and a stranger has nothing to claim.
    assert_eq!(
        s.contract.try_refund(&s.alice),
        Err(Ok(Error::NothingToRefund))
    );
    assert_eq!(
        s.contract.try_refund(&s.recipient),
        Err(Ok(Error::NothingToRefund))
    );
}

#[test]
fn refund_blocked_when_goal_was_met() {
    let s = setup(150);
    s.contract.contribute(&s.alice, &100);
    s.contract.contribute(&s.bob, &50);
    s.env.ledger().set_timestamp(s.deadline);
    assert_eq!(
        s.contract.try_refund(&s.alice),
        Err(Ok(Error::GoalAlreadyMet))
    );
}

#[test]
fn contribute_requires_contributor_auth() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    // Deliberately no mock_all_auths: the call must not go through unsigned.
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let recipient = Address::generate(&env);
    let alice = Address::generate(&env);
    let deadline = env.ledger().timestamp() + DAY;
    let id = env.register(
        Campaign,
        (
            sac.address(),
            recipient,
            String::from_str(&env, "Unauthorized"),
            500i128,
            deadline,
        ),
    );

    assert!(CampaignClient::new(&env, &id)
        .try_contribute(&alice, &10)
        .is_err());
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn constructor_rejects_zero_goal() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let deadline = env.ledger().timestamp() + DAY;
    env.register(
        Campaign,
        (
            sac.address(),
            Address::generate(&env),
            String::from_str(&env, "Zero goal"),
            0i128,
            deadline,
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn constructor_rejects_past_deadline() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    env.register(
        Campaign,
        (
            sac.address(),
            Address::generate(&env),
            String::from_str(&env, "Past deadline"),
            500i128,
            999u64,
        ),
    );
}
