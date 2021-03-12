use crate::*;

pub(crate) const ONE_YOCTO: Balance = 1;

pub(crate) fn assert_one_yocto() {
    assert_eq!(
        env::attached_deposit(),
        ONE_YOCTO,
        "Requires attached deposit of exactly 1 yoctoNEAR"
    )
}
