# Wonderland

A fork of berryclub designed to create a zero-sum ecosystem for custom fungible tokens.

## Definitions:
- `FT` - an instance of a fungible token used for this version of the Wonderland. E.g. wUSDC, wDAI or Banana.
- `L` - an inner fungible token used to track liquidity of this version of the Wonderland.
- `ft_pool` - the total amount of `FT` tokens that are used to determine current drawing pricing and reward distribution
- `l_pool` - the total amount of `L` tokens.

## Actions:
- Draw a pixel
- Add L
- Remove L
- Farm (passive)

### Draw a pixel

The cost of drawing a pixel is determined by current `ft_pool` and a fixed coefficient `pixel_coef` (e.g. `1 / 10000`)

`pixel_price = ft_pool * pixel_coef`

When drawing multiple pixels in one transaction it's should be possible to correctly compute the total price.

`draw_fee_coef` is used to determine which part of the pixel price goes to liquidity providers as a reward (e.g. `1 / 10`)

- `your_ft -= pixel_price` - withdrawing `FT` amount from your account.
- `lp_reward = draw_fee_coef * pixel_price` will be split proportionally to `L` owners at `your_l / l_pool`
- `ft_pool += pixel_price - lp_reward` increasing `FT` pool

### Add L

Anyone can buy `L` tokens at current `l_price`, but some amount of the newly minted `L` will be held by the app to
disincentive the liquidity providers from frequently add and remove liquidity.

`l_price = ft_pool / l_pool`

The amount you get depends on `farm_hold_coefficient` (e.g. `1 / 10`)
The amount of `FT` you want to spend.

- `your_ft -= ft_amount`
- `l_amount = ft_amount / l_price` - total amount of `L` being minted
- `app_l_amount = l_amount * farm_hold_coefficient` - the amount of `L` that will be forever held by the app to incentivize farmers.
- `your_l_amount = l_amount - app_l_amount` - the amount of `L` you get.
- `ft_pool += ft_amount` - increasing `FT` pool
- `l_pool += l_amount` - increasing `L` pool
- `your_l += your_l_amount` - increasing your `L` total amount
- `app_l += app_l_amount` - increasing app's `L` total amount

### Remove L

Any liquidity provider (except for the App) can remove the liquidity by burning `L` tokens and getting corresponding amount
of `FT` tokens based on the current `l_price`. There is no fee to remove `L`

- `l_amount` - the amount of `L` tokens to remove/burn
- `your_l -= l_amount` - remove `L` tokens from your balance
- `ft_amount = l_amount * l_price` - the amount `FT` you get for removing liquidity
- `your_ft += ft_amount` - increase your `FT` balance
- `ft_pool -= ft_amount` - decrease amount of `FT` in the pool
- `l_pool -= l_amount` - decrease amount of `L` in the pool

### Farm

Every second a pixel on board is earning `FT` tokens to the pixel owner based on current `ft_pool`.

- `ft_amount_per_pixel = (magic formula based on time) * ft_pool`
- `ft_pool -= ft_amount_per_pixel * num_active_pixels`
- `ft_farmed_per_pixel += ft_amount_per_pixel` - increased based on time passed from last update

Every account tracks:

- `last_ft_farmed_per_pixel` - the previous `ft_farmed_per_pixel` value
- `num_pixels` - the number of pixels the account owns on the board

Touching account

- `diff_ft_farmed_per_pixel = ft_farmed_per_pixel - last_ft_farmed_per_pixel` - the difference from the last time account was touched
- `farmed_ft_amount = diff_ft_farmed_per_pixel * num_pixels` - the accumulated farmed amount from last time
- `last_ft_farmed_per_pixel = ft_farmed_per_pixel` - remembering the current value
- `acc_ft += farmed_ft_amount` - adding farmed balance to the account balance

## App fee

The app owner will not be able to withdraw app liquidity, so the farmers can be certain that the `FT` pool can't be fully drained.
But the app owner will be able to claim draw fees earned by the app liquidity.
