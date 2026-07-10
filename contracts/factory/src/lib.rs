#![no_std]

//! A launchpad that deploys and tracks crowdfunding campaigns.
//!
//! Three kinds of inter-contract communication happen here:
//!
//! 1. **Deployment** — `create` deploys a fresh instance of the campaign wasm
//!    and calls its constructor, all in one transaction.
//! 2. **Cross-contract reads** — `stats` and `listing` call `state()` on every
//!    deployed campaign and aggregate the results.
//! 3. **Nested token calls** — each campaign, in turn, calls the token contract
//!    to move funds into escrow.
//!
//! Only the campaign's *wasm hash* is stored here, so a campaign that the
//! factory deployed is an ordinary independent contract afterwards.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, xdr::ToXdr, Address,
    Bytes, BytesN, Env, String, Vec,
};

mod campaign {
    // Generates `Client` and `State` from the built campaign wasm. Run
    // `make build` (or `stellar contract build --package campaign`) first.
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/campaign.wasm");
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    TitleEmpty = 1,
    TitleTooLong = 2,
    InvalidGoal = 3,
    InvalidDeadline = 4,
}

const MAX_TITLE_LEN: u32 = 64;

/// Reading every campaign costs one cross-contract call each, so aggregate
/// reads are capped rather than growing without bound as the launchpad fills.
const MAX_AGGREGATE: u32 = 50;

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub token: Address,
    pub campaign_wasm: BytesN<32>,
}

/// One row of the launchpad listing: where the campaign lives, plus its state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Listing {
    pub address: Address,
    pub title: String,
    pub creator: Address,
    pub goal: i128,
    pub raised: i128,
    pub deadline: u64,
    pub contributors: u32,
    pub withdrawn: bool,
}

/// Totals across the campaigns the factory has deployed.
///
/// Each campaign costs one cross-contract call to read, so `stats` only visits
/// the first `MAX_AGGREGATE` of them. `aggregated` says how many were actually
/// summed — when it is smaller than `campaigns`, the totals are a lower bound,
/// not the whole launchpad.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stats {
    pub campaigns: u32,
    pub aggregated: u32,
    pub total_raised: i128,
    pub total_goal: i128,
    pub funded: u32,
}

#[contracttype]
pub enum DataKey {
    Config,
    Campaigns,
}

/// Topics: `("created", creator, campaign)`. Data: `{ title, goal, deadline }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Created {
    #[topic]
    pub creator: Address,
    #[topic]
    pub campaign: Address,
    pub title: String,
    pub goal: i128,
    pub deadline: u64,
}

/// Topics: `("wasm_set", admin)`. Data: `{ wasm }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WasmSet {
    #[topic]
    pub admin: Address,
    pub wasm: BytesN<32>,
}

const DAY_LEDGERS: u32 = 17_280;
const INSTANCE_TTL: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = 7 * DAY_LEDGERS;

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    pub fn __constructor(env: Env, admin: Address, token: Address, campaign_wasm: BytesN<32>) {
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                token,
                campaign_wasm,
            },
        );
        env.storage()
            .instance()
            .set(&DataKey::Campaigns, &Vec::<Address>::new(&env));
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);
    }

    /// Deploy a new campaign contract and remember its address.
    ///
    /// The deployed address is derived from this contract plus a salt, so it is
    /// deterministic and cannot collide with another campaign.
    pub fn create(
        env: Env,
        creator: Address,
        title: String,
        goal: i128,
        deadline: u64,
    ) -> Result<Address, Error> {
        creator.require_auth();
        Self::bump(&env);

        if title.len() == 0 {
            return Err(Error::TitleEmpty);
        }
        if title.len() > MAX_TITLE_LEN {
            return Err(Error::TitleTooLong);
        }
        if goal <= 0 {
            return Err(Error::InvalidGoal);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }

        let config = Self::read_config(&env);
        let mut campaigns = Self::campaign_list(&env);

        let address = env
            .deployer()
            .with_current_contract(Self::salt(&env, &creator, campaigns.len()))
            .deploy_v2(
                config.campaign_wasm.clone(),
                (
                    config.token.clone(),
                    creator.clone(),
                    title.clone(),
                    goal,
                    deadline,
                ),
            );

        campaigns.push_back(address.clone());
        env.storage().instance().set(&DataKey::Campaigns, &campaigns);

        Created {
            creator,
            campaign: address.clone(),
            title,
            goal,
            deadline,
        }
        .publish(&env);

        Ok(address)
    }

    /// Point future deployments at a new campaign wasm. Existing campaigns keep
    /// running the code they were deployed with.
    pub fn set_campaign_wasm(env: Env, wasm: BytesN<32>) {
        let mut config = Self::read_config(&env);
        config.admin.require_auth();

        config.campaign_wasm = wasm.clone();
        env.storage().instance().set(&DataKey::Config, &config);

        WasmSet {
            admin: config.admin,
            wasm,
        }
        .publish(&env);
    }

    pub fn campaigns(env: Env) -> Vec<Address> {
        Self::campaign_list(&env)
    }

    pub fn config(env: Env) -> Config {
        Self::read_config(&env)
    }

    /// The launchpad listing: one cross-contract `state()` call per campaign.
    ///
    /// `start` and `limit` page through the campaigns; `limit` is clamped so a
    /// single call can never exceed the contract's resource budget.
    pub fn listing(env: Env, start: u32, limit: u32) -> Vec<Listing> {
        let campaigns = Self::campaign_list(&env);
        let end = (start.saturating_add(limit.min(MAX_AGGREGATE))).min(campaigns.len());

        let mut rows = vec![&env];
        for index in start..end {
            let address = campaigns.get(index).unwrap();
            let state = campaign::Client::new(&env, &address).state();
            rows.push_back(Listing {
                address,
                title: state.title,
                creator: state.recipient,
                goal: state.goal,
                raised: state.raised,
                deadline: state.deadline,
                contributors: state.contributors,
                withdrawn: state.withdrawn,
            });
        }
        rows
    }

    /// Totals across the campaigns, aggregated by calling `state()` on each.
    ///
    /// See [`Stats`]: past `MAX_AGGREGATE` campaigns the totals are a lower
    /// bound, and `aggregated` reports how many were summed.
    pub fn stats(env: Env) -> Stats {
        let campaigns = Self::campaign_list(&env);
        let aggregated = campaigns.len().min(MAX_AGGREGATE);

        let mut stats = Stats {
            campaigns: campaigns.len(),
            aggregated,
            total_raised: 0,
            total_goal: 0,
            funded: 0,
        };

        for index in 0..aggregated {
            let address = campaigns.get(index).unwrap();
            let state = campaign::Client::new(&env, &address).state();

            stats.total_raised += state.raised;
            stats.total_goal += state.goal;
            if state.raised >= state.goal {
                stats.funded += 1;
            }
        }
        stats
    }

    /// Whether this factory deployed the given address.
    pub fn is_campaign(env: Env, address: Address) -> bool {
        Self::campaign_list(&env).contains(&address)
    }

    fn read_config(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn campaign_list(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Campaigns)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// Salt from the creator and the campaign index, so two creators — and one
    /// creator twice — always land on different addresses.
    fn salt(env: &Env, creator: &Address, index: u32) -> BytesN<32> {
        let mut seed = Bytes::new(env);
        seed.append(&creator.clone().to_xdr(env));
        seed.extend_from_array(&index.to_be_bytes());
        env.crypto().sha256(&seed).into()
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);
    }
}

mod test;
