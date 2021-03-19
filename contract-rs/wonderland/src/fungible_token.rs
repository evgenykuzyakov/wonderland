use crate::*;
use near_sdk::{ext_contract, Gas, PromiseOrValue};

const FT_TRANSFER_GAS: Gas = 5_000_000_000_000;

pub trait FungibleTokenReceiver {
    /// Called by fungible token contract after `ft_transfer_call` was initiated by
    /// `sender_id` of the given `amount` with the transfer message given in `msg` field.
    /// The `amount` of tokens were already transferred to this contract account and ready to be used.
    ///
    /// The method must return the amount of tokens that are *not* used/accepted by this contract from the transferred
    /// amount. Examples:
    /// - The transferred amount was `500`, the contract completely takes it and must return `0`.
    /// - The transferred amount was `500`, but this transfer call only needs `450` for the action passed in the `msg`
    ///   field, then the method must return `50`.
    /// - The transferred amount was `500`, but the action in `msg` field has expired and the transfer must be
    ///   cancelled. The method must return `500` or panic.
    ///
    /// Arguments:
    /// - `sender_id` - the account ID that initiated the transfer.
    /// - `amount` - the amount of tokens that were transferred to this account in a decimal string representation.
    /// - `msg` - a string message that was passed with this transfer call.
    ///
    /// Returns the amount of unused tokens that should be returned to sender, in a decimal string representation.
    fn ft_on_transfer(
        &mut self,
        sender_id: ValidAccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128>;
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub enum FtMessage {
    Deposit,
}

#[near_bindgen]
impl FungibleTokenReceiver for Contract {
    fn ft_on_transfer(
        &mut self,
        sender_id: ValidAccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_eq!(
            &env::predecessor_account_id(),
            self.config.ft_account_id.as_ref()
        );

        let msg: FtMessage =
            near_sdk::serde_json::from_str(&msg).expect("Can't deserialize the msg");

        match msg {
            FtMessage::Deposit => {
                let mut account: Account = self.get_mut_account(sender_id.into());
                account.ft_balance += amount.0;
                log!("Deposited {} FT to @{}", amount.0, account.account_id);
                PromiseOrValue::Value(0.into())
            }
        }
    }
}

#[ext_contract(ext_ft_core)]
pub trait FungibleTokenCore {
    /// Transfers positive `amount` of tokens from the `env::predecessor_account_id` to `receiver_id`.
    /// Both accounts must be registered with the contract for transfer to succeed. (See [NEP-145](https://github.com/near/NEPs/discussions/145))
    /// This method must to be able to accept attached deposits, and must not panic on attached deposit.
    /// Exactly 1 yoctoNEAR must be attached.
    /// See [the Security section](https://github.com/near/NEPs/issues/141#user-content-security) of the standard.
    ///
    /// Arguments:
    /// - `receiver_id` - the account ID of the receiver.
    /// - `amount` - the amount of tokens to transfer. Must be a positive number in decimal string representation.
    /// - `memo` - an optional string field in a free form to associate a memo with this transfer.
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

impl Contract {
    pub fn internal_withdraw_to(&mut self, account_id: AccountId, amount: TokenBalance) -> Promise {
        ext_ft_core::ft_transfer(
            account_id,
            amount.into(),
            Some("Wonderland withdrawal".to_string()),
            self.config.ft_account_id.as_ref(),
            ONE_YOCTO,
            FT_TRANSFER_GAS,
        )
    }
}
