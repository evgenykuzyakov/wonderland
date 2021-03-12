use uint::construct_uint;

construct_uint! {
    /// 256-bit unsigned integer.
    pub struct U256(4);
}

pub type FarmRatio = u128;

pub type TokenBalance = u128;

pub type AccountIndex = u32;
