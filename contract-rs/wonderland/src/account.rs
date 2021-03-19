use crate::*;

#[derive(BorshDeserialize, BorshSerialize)]
pub enum UpgradableAccount {
    Last(Account),
}

impl From<UpgradableAccount> for Account {
    fn from(account: UpgradableAccount) -> Self {
        match account {
            UpgradableAccount::Last(account) => account,
        }
    }
}

impl From<Account> for UpgradableAccount {
    fn from(account: Account) -> Self {
        UpgradableAccount::Last(account)
    }
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Account {
    pub account_id: AccountId,
    pub account_index: AccountIndex,
    pub last_ft_farmed_per_pixel: FarmRatio,

    pub ft_balance: TokenBalance,
    pub l_balance: TokenBalance,

    pub num_pixels: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HumanAccount {
    pub account_id: AccountId,
    pub account_index: AccountIndex,
    pub ft_balance: U128,
    pub l_balance: U128,
    pub num_pixels: u32,
}

impl From<Account> for HumanAccount {
    fn from(account: Account) -> Self {
        Self {
            account_id: account.account_id,
            account_index: account.account_index,
            ft_balance: account.ft_balance.into(),
            l_balance: account.l_balance.into(),
            num_pixels: account.num_pixels,
        }
    }
}

impl Account {
    pub fn new(
        account_id: AccountId,
        account_index: AccountIndex,
        ft_farmed_per_pixel: FarmRatio,
    ) -> Self {
        Self {
            account_id,
            account_index,
            last_ft_farmed_per_pixel: ft_farmed_per_pixel,
            ft_balance: 0,
            l_balance: 0,
            num_pixels: 0,
        }
    }

    pub fn touch(&mut self, ft_farmed_per_pixel: FarmRatio) -> TokenBalance {
        let ft_farmed_diff = ft_farmed_per_pixel - self.last_ft_farmed_per_pixel;
        let ft_farmed_amount = ft_farmed_diff * FarmRatio::from(self.num_pixels);
        self.ft_balance += ft_farmed_amount;
        self.last_ft_farmed_per_pixel = ft_farmed_per_pixel;
        ft_farmed_amount
    }

    pub fn charge(&mut self, ft_amount: TokenBalance) {
        assert!(
            self.ft_balance >= ft_amount,
            "Not enough FT balance to draw pixels"
        );
        self.ft_balance -= ft_amount;
    }
}

#[near_bindgen]
impl Contract {
    pub fn get_num_accounts(&self) -> u32 {
        self.num_accounts
    }

    pub fn register_account(&mut self) {
        let account = self.get_mut_account(env::predecessor_account_id());
        self.save_account(account);
    }

    #[payable]
    pub fn withdraw_ft(&mut self, amount: Option<U128>) -> Promise {
        assert_one_yocto();
        let mut account = self.get_mut_account(env::predecessor_account_id());
        let amount = amount.map(|a| a.into()).unwrap_or(account.ft_balance);
        if account.ft_balance < amount {
            env::panic(b"Account doesn't have enough FT balance");
        }
        account.ft_balance -= amount;
        let account_id = account.account_id.clone();
        self.save_account(account);
        self.internal_withdraw_to(account_id, amount)
    }

    pub fn account_exists(&self, account_id: ValidAccountId) -> bool {
        self.account_indices.contains_key(account_id.as_ref())
    }

    pub fn get_account_by_index(&self, account_index: AccountIndex) -> Option<HumanAccount> {
        self.get_internal_account_by_index(account_index)
            .map(|mut account| {
                account.touch(self.ft_farmed_per_pixel);
                account.into()
            })
    }

    pub fn get_account(&self, account_id: ValidAccountId) -> Option<HumanAccount> {
        self.get_internal_account_by_id(account_id.as_ref())
            .map(|mut account| {
                account.touch(self.ft_farmed_per_pixel);
                account.into()
            })
    }
}

impl Contract {
    pub fn get_internal_account_by_id(&self, account_id: &AccountId) -> Option<Account> {
        self.account_indices
            .get(&account_id)
            .and_then(|account_index| self.get_internal_account_by_index(account_index))
    }

    pub fn get_app_account(&mut self) -> Account {
        let mut account = self.get_internal_account_by_index(0).unwrap();
        self.touch_account(&mut account);
        account
    }

    pub fn get_mut_account(&mut self, account_id: AccountId) -> Account {
        let mut account = self
            .get_internal_account_by_id(&account_id)
            .unwrap_or_else(|| {
                Account::new(account_id, self.num_accounts, self.ft_farmed_per_pixel)
            });
        self.touch_account(&mut account);
        account
    }

    pub fn get_internal_account_by_index(&self, account_index: AccountIndex) -> Option<Account> {
        self.accounts
            .get(&account_index)
            .map(|account| account.into())
    }

    pub fn touch_account(&mut self, account: &mut Account) {
        let ft_farmed = account.touch(self.ft_farmed_per_pixel);
        if ft_farmed > 0 {
            self.stats.ft_farmed.0 += ft_farmed;
        }
    }

    pub fn save_account(&mut self, account: Account) {
        let account_index = account.account_index;
        if account_index >= self.num_accounts {
            self.account_indices
                .insert(&account.account_id, &account_index);
            self.num_accounts += 1;
        }
        self.accounts.insert(&account_index, &account.into());
    }
}
