use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{ValidAccountId, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, log, near_bindgen, AccountId, Balance, PanicOnDefault, Promise, Timestamp};

pub mod account;
pub use crate::account::*;

pub mod board;
pub use crate::board::*;

mod internal;
use crate::internal::*;

mod liquidity;
pub use crate::liquidity::*;

mod types;
use types::*;

mod fungible_token;
pub use crate::fungible_token::*;

near_sdk::setup_alloc!();

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ContractConfig {
    pub ft_account_id: ValidAccountId,
    pub app_owner_id: ValidAccountId,

    pub app_liquidity_denominator: U128,
    pub pixel_coef_denominator: U128,
    pub draw_fee_denominator: U128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Stats {
    pub ft_draw_fee: U128,
    pub ft_draw_spent: U128,
    pub ft_farmed: U128,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
#[borsh_init(touch)]
pub struct Contract {
    pub account_indices: LookupMap<AccountId, u32>,
    pub accounts: LookupMap<u32, UpgradableAccount>,
    pub num_accounts: u32,

    pub board: board::PixelBoard,

    pub config: ContractConfig,
    pub stats: Stats,

    pub ft_farmed_per_pixel: FarmRatio,
    pub last_timestamp_touched: Timestamp,

    pub ft_pool: TokenBalance,
    pub l_pool: TokenBalance,
}

#[near_bindgen]
impl Contract {
    #[init]
    pub fn new(config: ContractConfig) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let mut this = Self {
            account_indices: LookupMap::new(b"i".to_vec()),
            accounts: LookupMap::new(b"u".to_vec()),
            num_accounts: 0,

            board: PixelBoard::new(),

            config,

            stats: Stats {
                ft_draw_fee: U128(0),
                ft_draw_spent: U128(0),
                ft_farmed: U128(0),
            },

            ft_farmed_per_pixel: 0,
            last_timestamp_touched: env::block_timestamp(),

            ft_pool: 0,
            l_pool: 0,
        };

        let mut account = this.get_mut_account(this.config.app_owner_id.clone().into());
        account.num_pixels = TOTAL_NUM_PIXELS;
        this.save_account(account);

        this
    }

    pub fn draw(&mut self, pixels: Vec<SetPixelRequest>) {
        if pixels.is_empty() {
            return;
        }
        let mut account = self.get_mut_account(env::predecessor_account_id());
        let new_pixels = pixels.len() as u32;

        // Computing pixel price
        let mut ft_amount = 0;
        let mut ft_draw_fee = 0;
        for _i in 0..new_pixels {
            let pixel_ft = self.ft_pool / self.config.pixel_coef_denominator.0;
            ft_amount += pixel_ft;
            let pixel_ft_draw_fee = pixel_ft / self.config.draw_fee_denominator.0;
            ft_draw_fee += pixel_ft_draw_fee;
            self.ft_pool += pixel_ft - pixel_ft_draw_fee;
        }

        account.charge(ft_amount);
        self.stats.ft_draw_fee.0 += ft_draw_fee;
        self.stats.ft_draw_spent.0 += ft_amount;

        let mut old_owners = self.board.set_pixels(account.account_index, &pixels);
        let replaced_pixels = old_owners.remove(&account.account_index).unwrap_or(0);
        account.num_pixels += new_pixels - replaced_pixels;
        self.save_account(account);

        for (account_index, num_pixels) in old_owners {
            let mut account = self.get_internal_account_by_index(account_index).unwrap();
            self.touch_account(&mut account);
            account.num_pixels -= num_pixels;
            self.save_account(account);
        }
    }

    pub fn get_config(self) -> ContractConfig {
        self.config
    }

    pub fn get_stats(self) -> Stats {
        self.stats
    }
}

impl Contract {
    pub fn touch(&mut self) {
        let timestamp = env::block_timestamp();
        let time_diff = timestamp - self.last_timestamp_touched;
        self.last_timestamp_touched = timestamp;
        if self.ft_pool <= MIN_FT_POOL {
            return;
        }
        // TODO: Magic formula
        let added_ft_farmed_per_pixel = 0;
        let ft_amount = added_ft_farmed_per_pixel * FarmRatio::from(BOARD_HEIGHT * BOARD_WIDTH);
        self.ft_farmed_per_pixel += added_ft_farmed_per_pixel;
        self.ft_pool -= ft_amount;
    }
}
