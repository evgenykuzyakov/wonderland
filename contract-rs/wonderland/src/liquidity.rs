use crate::*;

pub const MIN_FT_POOL: TokenBalance = 1_000_000_000_000_000_000;

#[near_bindgen]
impl Contract {
    #[payable]
    pub fn add_liquidity(&mut self, ft_amount: TokenBalance, min_l_amount: TokenBalance) {
        assert_one_yocto();
        self.touch();
        let mut account = self.get_mut_account(env::predecessor_account_id());
        assert_ne!(
            account.account_index, 0,
            "The app owner can't add or remove liquidity"
        );
        if account.ft_balance < ft_amount {
            env::panic(b"Not enough FT balance on the account");
        }
        account.ft_balance -= ft_amount;

        let new_ft_pool = self.ft_pool + ft_amount;
        if new_ft_pool < MIN_FT_POOL {
            env::panic(
                format!(
                    "The new FT pool {} has to be above MIN_FT_POOL {}",
                    new_ft_pool, MIN_FT_POOL
                )
                .as_bytes(),
            );
        }

        let l_amount = self.internal_l_from_ft(ft_amount);
        if l_amount < min_l_amount {
            env::panic(
                format!(
                    "The resulting L {} is lower than {}",
                    l_amount, min_l_amount
                )
                .as_bytes(),
            );
        }

        let app_l_amount = l_amount / self.config.app_liquidity_denominator.0;
        account.l_balance += l_amount - app_l_amount;
        log!("Minted {} L for {} FT", l_amount, ft_amount);

        self.l_pool += l_amount;
        self.ft_pool += ft_amount;

        self.save_account(account);

        let mut app_account = self.get_app_account();
        app_account.l_balance += app_l_amount;
        self.save_account(app_account);
    }

    #[payable]
    pub fn remove_liquidity(&mut self, l_amount: TokenBalance, min_ft_amount: TokenBalance) {
        assert_one_yocto();
        self.touch();
        let mut account = self.get_mut_account(env::predecessor_account_id());
        assert_ne!(
            account.account_index, 0,
            "The app owner can't add or remove liquidity"
        );
        if account.l_balance < l_amount {
            env::panic(b"Not enough L balance on the account");
        }
        account.l_balance -= l_amount;

        let ft_amount = self.internal_ft_from_l(l_amount);

        if ft_amount < min_ft_amount {
            env::panic(
                format!(
                    "The resulting FT {} is lower than {}",
                    ft_amount, min_ft_amount
                )
                .as_bytes(),
            );
        }

        self.ft_pool -= ft_amount;
        if self.ft_pool < MIN_FT_POOL {
            env::panic(
                format!(
                    "The new FT pool {} has to be above MIN_FT_POOL {}",
                    self.ft_pool, MIN_FT_POOL
                )
                .as_bytes(),
            );
        }

        account.ft_balance -= ft_amount;
        log!("Burned {} L for {} FT", l_amount, ft_amount);

        self.l_pool -= l_amount;

        self.save_account(account);
    }
}

impl Contract {
    pub fn internal_ft_from_l(&self, l_amount: TokenBalance) -> TokenBalance {
        if self.ft_pool < MIN_FT_POOL {
            env::panic(
                format!(
                    "The FT pool {} has to be above MIN_FT_POOL {}",
                    self.ft_pool, MIN_FT_POOL
                )
                .as_bytes(),
            );
        }
        (U256::from(l_amount) * U256::from(self.ft_pool) / U256::from(self.l_pool)).as_u128()
    }

    pub fn internal_l_from_ft(&self, ft_amount: TokenBalance) -> TokenBalance {
        if self.ft_pool < MIN_FT_POOL {
            return ft_amount;
        }
        (U256::from(ft_amount) * U256::from(self.l_pool) / U256::from(self.ft_pool)).as_u128()
    }
}
