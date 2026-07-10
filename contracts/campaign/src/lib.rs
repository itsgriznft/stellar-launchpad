#![no_std]

//! A single crowdfunding campaign.
//!
//! Contributors send a token to the contract until `deadline`. If `goal` is
//! reached by then, `recipient` withdraws the pot; otherwise every contributor
//! can pull their own money back with `refund`.
//!
//! Campaigns are normally created by the factory, which deploys one instance of
//! this wasm per campaign. Nothing here depends on the factory, so a campaign
//! can also be deployed on its own.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidGoal = 1,
    InvalidDeadline = 2,
    InvalidAmount = 3,
    CampaignEnded = 4,
    CampaignActive = 5,
    GoalNotMet = 6,
    GoalAlreadyMet = 7,
    AlreadyWithdrawn = 8,
    NothingToRefund = 9,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub token: Address,
    pub recipient: Address,
    pub title: String,
    pub goal: i128,
    pub deadline: u64,
}

/// Everything a caller — a frontend, or the factory — needs, in one read.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct State {
    pub token: Address,
    pub recipient: Address,
    pub title: String,
    pub goal: i128,
    pub deadline: u64,
    pub raised: i128,
    pub contributors: u32,
    pub withdrawn: bool,
}

#[contracttype]
pub enum DataKey {
    Config,
    Raised,
    Contributors,
    Withdrawn,
    Contribution(Address),
}

/// Topics: `("contributed", contributor)`. Data: `{ amount, raised }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contributed {
    #[topic]
    pub contributor: Address,
    pub amount: i128,
    pub raised: i128,
}

/// Topics: `("withdrawn", recipient)`. Data: `{ amount }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub recipient: Address,
    pub amount: i128,
}

/// Topics: `("refunded", contributor)`. Data: `{ amount, raised }`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refunded {
    #[topic]
    pub contributor: Address,
    pub amount: i128,
    pub raised: i128,
}

// Instance TTL: bump to ~30 days whenever it drops below ~7 days.
const DAY_LEDGERS: u32 = 17_280;
const INSTANCE_TTL: u32 = 30 * DAY_LEDGERS;
const INSTANCE_THRESHOLD: u32 = 7 * DAY_LEDGERS;

#[contract]
pub struct Campaign;

#[contractimpl]
impl Campaign {
    pub fn __constructor(
        env: Env,
        token: Address,
        recipient: Address,
        title: String,
        goal: i128,
        deadline: u64,
    ) {
        if goal <= 0 {
            panic_with_error!(&env, Error::InvalidGoal);
        }
        if deadline <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::InvalidDeadline);
        }

        let storage = env.storage().instance();
        storage.set(
            &DataKey::Config,
            &Config {
                token,
                recipient,
                title,
                goal,
                deadline,
            },
        );
        storage.set(&DataKey::Raised, &0i128);
        storage.set(&DataKey::Contributors, &0u32);
        storage.set(&DataKey::Withdrawn, &false);
        storage.extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);
    }

    /// Send `amount` of the campaign token to the contract. Emits `contributed`.
    pub fn contribute(env: Env, contributor: Address, amount: i128) -> Result<i128, Error> {
        contributor.require_auth();
        Self::bump(&env);

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let config = Self::config(&env);
        if env.ledger().timestamp() >= config.deadline {
            return Err(Error::CampaignEnded);
        }

        // Fails (and reverts the whole call) if the contributor is short on funds.
        token::TokenClient::new(&env, &config.token).transfer(
            &contributor,
            &env.current_contract_address(),
            &amount,
        );

        let key = DataKey::Contribution(contributor.clone());
        let previous: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if previous == 0 {
            let count: u32 = Self::get(&env, &DataKey::Contributors, 0u32);
            env.storage()
                .instance()
                .set(&DataKey::Contributors, &(count + 1));
        }
        env.storage().persistent().set(&key, &(previous + amount));
        env.storage()
            .persistent()
            .extend_ttl(&key, INSTANCE_THRESHOLD, INSTANCE_TTL);

        let raised: i128 = Self::get(&env, &DataKey::Raised, 0i128) + amount;
        env.storage().instance().set(&DataKey::Raised, &raised);

        Contributed {
            contributor,
            amount,
            raised,
        }
        .publish(&env);

        Ok(raised)
    }

    /// Recipient pulls the pot once the deadline passed and the goal was met.
    pub fn withdraw(env: Env) -> Result<i128, Error> {
        Self::bump(&env);
        let config = Self::config(&env);
        config.recipient.require_auth();

        if env.ledger().timestamp() < config.deadline {
            return Err(Error::CampaignActive);
        }
        let raised: i128 = Self::get(&env, &DataKey::Raised, 0i128);
        if raised < config.goal {
            return Err(Error::GoalNotMet);
        }
        if Self::get(&env, &DataKey::Withdrawn, false) {
            return Err(Error::AlreadyWithdrawn);
        }

        env.storage().instance().set(&DataKey::Withdrawn, &true);
        token::TokenClient::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &config.recipient,
            &raised,
        );

        Withdrawn {
            recipient: config.recipient,
            amount: raised,
        }
        .publish(&env);

        Ok(raised)
    }

    /// Contributor pulls their own money back after a failed campaign.
    pub fn refund(env: Env, contributor: Address) -> Result<i128, Error> {
        contributor.require_auth();
        Self::bump(&env);

        let config = Self::config(&env);
        if env.ledger().timestamp() < config.deadline {
            return Err(Error::CampaignActive);
        }
        let raised: i128 = Self::get(&env, &DataKey::Raised, 0i128);
        if raised >= config.goal {
            return Err(Error::GoalAlreadyMet);
        }

        let key = DataKey::Contribution(contributor.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount <= 0 {
            return Err(Error::NothingToRefund);
        }

        env.storage().persistent().set(&key, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::Raised, &(raised - amount));
        token::TokenClient::new(&env, &config.token).transfer(
            &env.current_contract_address(),
            &contributor,
            &amount,
        );

        Refunded {
            contributor,
            amount,
            raised: raised - amount,
        }
        .publish(&env);

        Ok(amount)
    }

    pub fn state(env: Env) -> State {
        let config = Self::config(&env);
        State {
            token: config.token,
            recipient: config.recipient,
            title: config.title,
            goal: config.goal,
            deadline: config.deadline,
            raised: Self::get(&env, &DataKey::Raised, 0i128),
            contributors: Self::get(&env, &DataKey::Contributors, 0u32),
            withdrawn: Self::get(&env, &DataKey::Withdrawn, false),
        }
    }

    pub fn contribution(env: Env, contributor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Contribution(contributor))
            .unwrap_or(0)
    }

    fn config(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn get<T>(env: &Env, key: &DataKey, default: T) -> T
    where
        T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>
            + soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
    {
        env.storage().instance().get(key).unwrap_or(default)
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_TTL);
    }
}

mod test;
