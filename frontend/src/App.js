import "./App.scss";
import "./gh-fork-ribbon.css";
import React from 'react';
import BN from 'bn.js';
import * as nearAPI from 'near-api-js'
import { AlphaPicker, HuePicker, GithubPicker } from 'react-color'
import Switch from "react-switch"

const PixelPrice = new BN("10000000000000000000000");
const IsMainnet = false; // window.location.hostname === "berryclub.io";
const TestNearConfig = {
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.near.org',
  contractName: 'dev-1615590559953-5504799',
  walletUrl: 'https://wallet.testnet.near.org',
};
const MainNearConfig = {
  networkId: 'mainnet',
  nodeUrl: 'https://rpc.mainnet.near.org',
  contractName: 'berryclub.ek.near',
  walletUrl: 'https://wallet.near.org',
};
const NearConfig = IsMainnet ? MainNearConfig : TestNearConfig;

const BoardHeight = 50;
const BoardWidth = 50;
const NumLinesPerFetch = 10;
const ExpectedLineLength = 4 + 8 * BoardWidth;
const CellWidth = 12;
const CellHeight = 12;
const MaxNumColors = 31;
const BatchOfPixels = 100;
// 500 ms
const BatchTimeout = 500;
const RefreshBoardTimeout = 1000;
const MaxWorkTime = 10 * 60 * 1000;

const intToColor = (c) => `#${c.toString(16).padStart(6, '0')}`;
const intToColorWithAlpha = (c, a) => `#${c.toString(16).padStart(6, '0')}${Math.round(255 * a).toString(16).padStart(2, '0')}`;

const rgbaToInt = (cr, cg, cb, ca, bgColor) => {
  const bb = (bgColor & 255);
  const bg = ((bgColor >> 8) & 255);
  const br = ((bgColor >> 16) & 255);

  const r = Math.round(cr * ca + br * (1 - ca));
  const g = Math.round(cg * ca + bg * (1 - ca));
  const b = Math.round(cb * ca + bb * (1 - ca));
  return (r << 16) + (g << 8) + b;
}

const imgColorToInt = (c, bgColor) => {
  const cr = (c & 255);
  const cg = ((c >> 8) & 255);
  const cb = ((c >> 16) & 255);
  const ca = ((c >> 24) & 255) / 255;
  return rgbaToInt(cr, cg, cb, ca, bgColor);
}

  const int2hsv = (cInt) => {
  cInt = intToColor(cInt).substr(1)
  const r = parseInt(cInt.substr(0, 2), 16) / 255
  const g = parseInt(cInt.substr(2, 2), 16) / 255
  const b = parseInt(cInt.substr(4, 2), 16) / 255
  let v=Math.max(r,g,b), c=v-Math.min(r,g,b);
  let h= c && ((v===r) ? (g-b)/c : ((v===g) ? 2+(b-r)/c : 4+(r-g)/c));
  return [60*(h<0?h+6:h), v&&c/v, v];
}
const transparentColor = (c, a) => `rgba(${(c >> 16) / 1}, ${((c >> 8) & 0xff) / 1}, ${(c & 0xff) / 1}, ${a})`
const generateGamma = (hue) => {
  const gammaColors = [];
  for (let i = 0; i < MaxNumColors; ++i) {
    gammaColors.push(`hsl(${hue}, 100%, ${100 * i / (MaxNumColors - 1)}%)`);
  }
  return gammaColors;
};
const decodeLine = (line) => {
  let buf = Buffer.from(line, 'base64');
  if (buf.length !== ExpectedLineLength) {
    throw new Error("Unexpected encoded line length");
  }
  let pixels = []
  for (let i = 4; i < buf.length; i += 8) {
    let color = buf.readUInt32LE(i);
    let ownerIndex = buf.readUInt32LE(i + 4);
    pixels.push({
      color,
      ownerIndex,
    })
  }
  return pixels;
};

class App extends React.Component {
  constructor(props) {
    super(props);

    const colors = ["#000000", "#666666", "#aaaaaa", "#FFFFFF", "#F44E3B", "#D33115", "#9F0500", "#FE9200", "#E27300", "#C45100", "#FCDC00", "#FCC400", "#FB9E00", "#DBDF00", "#B0BC00", "#808900", "#A4DD00", "#68BC00", "#194D33", "#68CCCA", "#16A5A5", "#0C797D", "#73D8FF", "#009CE0", "#0062B1", "#AEA1FF", "#7B64FF", "#653294", "#FDA1FF", "#FA28FF", "#AB149E"].map((c) => c.toLowerCase());
    const currentColor = parseInt(colors[Math.floor(Math.random() * colors.length)].substring(1), 16);
    // const currentColor = parseInt(colors[0].substring(1), 16);
    const defaultAlpha = 1;

    this.state = {
      connected: false,
      signedIn: false,
      accountId: null,
      pendingPixels: 0,
      boardLoaded: false,
      selectedCell: null,
      alpha: defaultAlpha,
      currentColor,
      pickerColor: intToColorWithAlpha(currentColor, defaultAlpha),
      colors,
      gammaColors: generateGamma(0),
      pickingColor: false,
      owners: [],
      accounts: {},
      highlightedAccountIndex: -1,
      selectedOwnerIndex: false,
      showDepositDialog: false,
      showWithdrawDialog: false,
    };

    this._buttonDown = false;
    this._oldCounts = {};
    this._numFailedTxs = 0;
    this._balanceRefreshTimer = null;
    this.canvasRef = React.createRef();
    this._context = false;
    this._lines = false;
    this._queue = [];
    this._pendingPixels = [];
    this._refreshBoardTimer = null;
    this._sendQueueTimer = null;
    this._stopRefreshTime = new Date().getTime() + MaxWorkTime;
    this._accounts = {};

    this._initNear().then(() => {
      this.setState({
        connected: true,
        signedIn: !!this._accountId,
        accountId: this._accountId,
        ircAccountId: this._accountId.replace('.', '_')
      });
    });
  }

  componentDidMount() {
    const canvas = this.canvasRef.current;
    this._context = canvas.getContext('2d');

    const click = async () => {
      if (this.state.rendering) {
        await this.drawImg(this.state.selectedCell);
      } else if (this.state.pickingColor) {
        this.pickColor(this.state.selectedCell);
      } else {
        this.saveColor();
        await this.drawPixel(this.state.selectedCell);
      }
    };

    const mouseMove = (e) => {
      let x, y;
      if ('touches' in e) {
        if (e.touches.length > 1) {
          return true;
        } else {
          const rect = e.target.getBoundingClientRect();
          x = e.targetTouches[0].clientX - rect.left;
          y = e.targetTouches[0].clientY - rect.top;
        }
      } else {
        x = e.offsetX;
        y = e.offsetY;
      }
      x = Math.trunc(x / e.target.clientWidth * BoardWidth);
      y = Math.trunc(y / e.target.clientHeight * BoardWidth);
      let cell = null;
      if (x >= 0 && x < BoardWidth && y >= 0 && y < BoardHeight) {
        cell = {x, y};
      }
      if (JSON.stringify(cell) !== JSON.stringify(this.state.selectedCell)) {
        this.setState({
          selectedCell: cell,
          selectedOwnerIndex: this._lines && cell && this._lines[cell.y] && this._lines[cell.y][cell.x].ownerIndex
        }, async () => {
          this.renderCanvas()
          if (this.state.selectedCell !== null && this._buttonDown) {
            await click();
          }
        })
      }
      e.preventDefault();
      return false;
    };

    canvas.addEventListener('mousemove', mouseMove);
    canvas.addEventListener('touchmove', mouseMove);

    const mouseDown = async (e) => {
      this._buttonDown = true;
      if (this.state.selectedCell !== null) {
        await click();
      }
    };

    canvas.addEventListener('mousedown', mouseDown);
    canvas.addEventListener('touchstart', mouseDown);

    const unselectCell = () => {
      this.setState({
        selectedCell: null,
      }, () => this.renderCanvas());
    }

    const mouseUp = async (e) => {
      this._buttonDown = false;
      if ('touches' in e) {
        unselectCell();
      }
    }

    canvas.addEventListener('mouseup', mouseUp);
    canvas.addEventListener('touchend', mouseUp);

    canvas.addEventListener('mouseleave', unselectCell);

    canvas.addEventListener('mouseenter', (e) => {
      if (this._buttonDown) {
        if (!('touches' in e) && !(e.buttons & 1)) {
          this._buttonDown = false;
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      e.altKey && this.enablePickColor()
    })

    document.addEventListener('keyup', (e) => {
      !e.altKey && this.disablePickColor();
    })
  }

  enablePickColor() {
    this.setState({
      pickingColor: true,
    }, () => {
      this.renderCanvas()
    });
  }

  disablePickColor() {
    this.setState({
      pickingColor: false,
    }, () => {
      this.renderCanvas()
    });
  }

  pickColor(cell) {
    if (!this.state.signedIn || !this._lines || !this._lines[cell.y]) {
      return;
    }
    const color = this._lines[cell.y][cell.x].color;

    this.setState({
      currentColor: color,
      alpha: 1,
      pickerColor: intToColorWithAlpha(color, 1),
      gammaColors: generateGamma(int2hsv(color)[0]),
      pickingColor: false,
    }, () => {
      this.renderCanvas()
    });
  }

  async _sendQueue() {
    const pixels = this._queue.slice(0, BatchOfPixels);
    this._queue = this._queue.slice(BatchOfPixels);
    this._pendingPixels = pixels;

    try {
      await this._contract.draw({
        pixels
      }, new BN("75000000000000"));
      this._numFailedTxs = 0;
    } catch (error) {
      console.log("Failed to send a transaction", error);
      this._numFailedTxs += 1;
      if (this._numFailedTxs < 3) {
        this._queue = this._queue.concat(this._pendingPixels);
        this._pendingPixels = [];
      } else {
        this._pendingPixels = [];
        this._queue = [];
      }
    }
    try {
      await Promise.all([this.refreshBoard(true), this.refreshAccountStats()]);
    } catch (e) {
      // ignore
    }
    this._pendingPixels.forEach((p) => {
      if (this._pending[p.y][p.x] === p.color) {
        this._pending[p.y][p.x] = -1;
      }
    });
    this._pendingPixels = [];
  }

  async _pingQueue(ready) {
    if (this._sendQueueTimer) {
      clearTimeout(this._sendQueueTimer);
      this._sendQueueTimer = null;
    }

    if (this._pendingPixels.length === 0 && (this._queue.length >= BatchOfPixels || ready)) {
      await this._sendQueue();
    }
    if (this._queue.length > 0) {
      this._sendQueueTimer = setTimeout(async () => {
        await this._pingQueue(true);
      }, BatchTimeout);
    }

  }

  async drawImg(cell) {
    if (!this.state.signedIn || !this._lines || !this._lines[cell.y]) {
      return;
    }
    const balance = this.state.account ? this.state.account.avocadoBalance : 0;

    if (balance - this.state.pendingPixels < this.state.avocadoNeeded) {
      return;
    }

    const img = this.imageData;
    const w = img.width;
    const h = img.height;
    const x = cell.x - Math.trunc(w / 2);
    const y = cell.y - Math.trunc(h / 2);
    const d = new Uint32Array(this.imageData.data.buffer);
    for (let i = 0; i < h; ++i) {
      for (let j = 0; j < w; ++j) {
        const imgColor = d[i * w + j];
        if (imgColor && y + i >= 0 && y + i < BoardHeight && x + j >= 0 && x + j < BoardWidth) {
          const bgColor = this._lines[y + i] ? this._lines[y + i][x + j].color : 0;
          const color = imgColorToInt(imgColor, bgColor);
          if (color !== bgColor) {
            this._queue.push({
              x: x + j,
              y: y + i,
              color,
            });
          }
        }
      }
    }
    this.setState({
      rendering: false,
    })

    this._stopRefreshTime = new Date().getTime() + MaxWorkTime;
    await this._pingQueue(false);
  }

  async drawPixel(cell) {
    if (!this.state.signedIn || !this._lines || !this._lines[cell.y]) {
      return;
    }
    const balance = this.state.account ? this.state.account.avocadoBalance : 0;
    if (balance - this.state.pendingPixels < 1) {
      return;
    }

    const bgColor = this._lines[cell.y] ? this._lines[cell.y][cell.x].color : 0;
    const cb = (this.state.currentColor & 255);
    const cg = ((this.state.currentColor >> 8) & 255);
    const cr = ((this.state.currentColor >> 16) & 255);
    const color = rgbaToInt(cr, cg, cb, this.state.alpha, bgColor);

    if (this._pending[cell.y][cell.x] !== color && this._lines[cell.y][cell.x].color !== color) {
      this._pending[cell.y][cell.x] = color;
    } else {
      return;
    }

    this._queue.push({
      x: cell.x,
      y: cell.y,
      color,
    });

    this._stopRefreshTime = new Date().getTime() + MaxWorkTime;
    await this._pingQueue(false);
  }

  parseAccount(account, accountId) {
    if (!account) {
      account = {
        accountId,
        accountIndex: -1,
        ftBalance: 0.0,
        lBalance: 0.0,
        numPixels: 0,
      }
    } else {
      account = {
        accountId: account.account_id,
        accountIndex: account.account_index,
        ftBalance: parseFloat(account.ft_balance) / this._pixelCost,
        lBalance: parseFloat(account.l_balance) / this._pixelCost,
        numPixels: account.num_pixels,
      }
    }
    account.startTime = new Date().getTime();
    return account;
  }

  async getAccount(accountId) {
    return this.parseAccount(
      await this._contract.get_account({account_id: accountId}),
      accountId
    );
  }

  async getAccountByIndex(accountIndex) {
    return this.parseAccount(
      await this._contract.get_account_by_index({account_index: accountIndex}),
      "unknown",
    );
  }

  async refreshAccountStats() {
    let account = await this.getAccount(this._accountId);
    if (this._balanceRefreshTimer) {
      clearInterval(this._balanceRefreshTimer);
      this._balanceRefreshTimer = null;
    }

    this.setState({
      pendingPixels: this._pendingPixels.length + this._queue.length,
      account,
    });

    /*
    this._balanceRefreshTimer = setInterval(() => {
      const t = new Date().getTime() - account.startTime;
      this.setState({
        account: Object.assign({}, account, {
          avocadoBalance: account.avocadoBalance + t * account.avocadoRewardPerMs,
          bananaBalance: account.bananaBalance + t * account.bananaRewardPerMs,
        }),
        pendingPixels: this._pendingPixels.length + this._queue.length,
      });
    }, 100);
     */
  }

  async _initNear() {
    const keyStore = new nearAPI.keyStores.BrowserLocalStorageKeyStore();
    const near = await nearAPI.connect(Object.assign({deps: {keyStore}}, NearConfig));
    this._keyStore = keyStore;
    this._near = near;

    this._walletConnection = new nearAPI.WalletConnection(near, NearConfig.contractName);
    this._accountId = this._walletConnection.getAccountId();

    this._account = this._walletConnection.account();
    this._contract = new nearAPI.Contract(this._account, NearConfig.contractName, {
      viewMethods: ['get_account', 'get_account_by_index', 'get_lines', 'get_line_versions', 'get_config', 'get_stats'],
      changeMethods: ['draw', 'buy_tokens', 'select_farming_preference'],
    });
    const config = await this._contract.get_config();
    this.config = {
      appAccountId: config.app_account_id,
      ftAccountId: config.ft_account_id,
      appLiquidity: 1 / parseFloat(config.app_liquidity_denominator),
      pixelCoef: 1 / parseFloat(config.pixel_coef_denominator),
      drawFee: 1 / parseFloat(config.draw_fee_denominator),
    }

    this._ftContract = new nearAPI.Contract(this._account, NearConfig.contractName, {
      viewMethods: ['ft_balance_of'],
      changeMethods: ['ft_transfer_call'],
    });

    this._pixelCost = 1e18;
    if (this._accountId) {
      await this.refreshAccountStats();
    }
    this._lineVersions = Array(BoardHeight).fill(-1);
    this._lines = Array(BoardHeight).fill(false);
    this._pending = Array(BoardHeight).fill(false);
    this._pending.forEach((v, i, a) => a[i] = Array(BoardWidth).fill(-1));
    await this.refreshBoard(true);
  }

  async refreshBoard(forced) {
    if (this._refreshBoardTimer) {
      clearTimeout(this._refreshBoardTimer);
      this._refreshBoardTimer = null;
    }
    const t = new Date().getTime();
    if (t < this._stopRefreshTime) {
      this._refreshBoardTimer = setTimeout(async () => {
        await this.refreshBoard(false);
      }, RefreshBoardTimeout);
    }

    if (!forced && document.hidden) {
      return;
    }

    let lineVersions = await this._contract.get_line_versions();
    let needLines = [];
    for (let i = 0; i < BoardHeight; ++i) {
      if (lineVersions[i] !== this._lineVersions[i]) {
        needLines.push(i);
      }
    }
    let requestLines = []
    for (let i = 0; i < needLines.length; i += NumLinesPerFetch) {
      requestLines.push(needLines.slice(i, i + NumLinesPerFetch));
    }

    let results = await Promise.all(requestLines.map(lines => this._contract.get_lines({lines})));
    results = results.flat();
    requestLines = requestLines.flat();
    for (let i = 0; i < requestLines.length; ++i) {
      let lineIndex = requestLines[i];
      let line = decodeLine(results[i]);
      this._lines[lineIndex] = line;
    }

    this._lineVersions = lineVersions;
    this._refreshOwners();
    this.renderCanvas();
  }

  _refreshOwners() {
    const counts = {};
    this._lines.flat().forEach((cell) => {
      counts[cell.ownerIndex] = (counts[cell.ownerIndex] || 0) + 1;
    })
    delete counts[0];
    const sortedKeys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    this.setState({
      owners: sortedKeys.map((accountIndex) => {
        accountIndex = parseInt(accountIndex);
        return {
          accountIndex,
          numPixels: counts[accountIndex],
        }
      })
    })
    sortedKeys.forEach(async (accountIndex) => {
      accountIndex = parseInt(accountIndex);
      if (!(accountIndex in this._accounts) || counts[accountIndex] !== (this._oldCounts[accountIndex] || 0)) {
        try {
          this._accounts[accountIndex] = await this.getAccountByIndex(accountIndex);
        } catch (err) {
          console.log("Failed to fetch account index #", accountIndex, err)
        }
        this.setState({
          accounts: Object.assign({}, this._accounts),
        })
      }
    })
    this.setState({
      accounts: Object.assign({}, this._accounts),
    })
    this._oldCounts = counts;
  }

  renderCanvas() {
    if (!this._context || !this._lines) {
      return;
    }

    const ctx = this._context;

    for (let i = 0; i < BoardHeight; ++i) {
      const line = this._lines[i];
      if (!line) {
        continue;
      }
      for (let j = 0; j < BoardWidth; ++j) {
        const p = line[j];
        ctx.fillStyle = intToColor(p.color);
        ctx.fillRect(j * CellWidth, i * CellHeight, CellWidth, CellHeight);
        if (this.state.highlightedAccountIndex >= 0) {
          if (p.ownerIndex !== this.state.highlightedAccountIndex) {
            ctx.fillStyle = 'rgba(32, 32, 32, 0.8)';
            ctx.fillRect(j * CellWidth, i * CellHeight, CellWidth / 2, CellHeight / 2);
            ctx.fillRect((j + 0.5) * CellWidth, (i + 0.5) * CellHeight, CellWidth / 2, CellHeight / 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(j * CellWidth, (i + 0.5) * CellHeight, CellWidth / 2, CellHeight / 2);
            ctx.fillRect((j + 0.5) * CellWidth, i * CellHeight, CellWidth / 2, CellHeight / 2);
          } else {
            ctx.beginPath();
            ctx.strokeStyle = ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 0.5;
            ctx.rect(j * CellWidth + 0.5, i * CellHeight + 0.5, CellWidth - 1, CellHeight - 1);
            ctx.stroke();
            ctx.closePath();
          }
        }
      }
    }

    this._pendingPixels.concat(this._queue).forEach((p) => {
      ctx.fillStyle = intToColor(p.color);
      ctx.fillRect(p.x * CellWidth, p.y * CellHeight, CellWidth, CellHeight);
    })

    if (this.state.selectedCell) {
      const c = this.state.selectedCell;
      if (this.state.rendering) {
        const img = this.imageData;
        const w = img.width;
        const h = img.height;
        const x = c.x - Math.trunc(w / 2);
        const y = c.y - Math.trunc(h / 2);
        const d = new Uint32Array(this.imageData.data.buffer);
        for (let i = 0; i < h; ++i) {
          for (let j = 0; j < w; ++j) {
            const color = d[i * w + j];
            if (color && y + i >= 0 && y + i < BoardHeight && x + j >= 0 && x + j < BoardWidth) {
              const bgColor = this._lines[y + i] ? this._lines[y + i][x + j].color : 0;
              ctx.fillStyle = intToColor(imgColorToInt(color, bgColor));
              ctx.fillRect((x + j) * CellWidth, (y + i) * CellHeight, CellWidth, CellHeight);
            }
          }
        }
      } else if (this.state.pickingColor) {
        const color = this._lines[c.y] ? this._lines[c.y][c.x].color : 0;
        ctx.beginPath();
        ctx.strokeStyle = ctx.fillStyle = transparentColor(color, 0.5);
        ctx.lineWidth = CellWidth * 4;
        ctx.arc((c.x + 0.5) * CellWidth, (c.y + 0.5) * CellHeight, CellWidth * 4, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.strokeStyle = ctx.fillStyle = transparentColor(color, 1);
        ctx.lineWidth = CellWidth * 2;
        ctx.arc((c.x + 0.5) * CellWidth, (c.y + 0.5) * CellHeight, CellWidth * 4, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.closePath();
      } else {
        ctx.fillStyle = transparentColor(this.state.currentColor, 0.2);
        ctx.fillRect(c.x * CellWidth, 0, CellWidth, c.y * CellHeight);
        ctx.fillRect(c.x * CellWidth, (c.y + 1) * CellHeight, CellWidth, (BoardHeight - c.y - 1) * CellHeight);
        ctx.fillRect(0, c.y * CellHeight, c.x * CellWidth, CellHeight);
        ctx.fillRect((c.x + 1) * CellWidth, c.y * CellHeight, (BoardWidth - c.x - 1) * CellWidth, CellHeight);

        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.fillStyle = intToColor(this.state.currentColor);
        ctx.strokeStyle = intToColor(this.state.currentColor);
        ctx.rect(c.x * CellWidth, c.y * CellHeight, CellWidth, CellHeight);
        ctx.stroke();
        ctx.closePath();
      }

    }


    if (!this.state.boardLoaded) {
      this.setState({
        boardLoaded: true
      })
    }
  }

  async requestSignIn() {
    const appTitle = 'Berry Club';
    await this._walletConnection.requestSignIn(
      NearConfig.contractName,
      appTitle
    )
  }

  async logOut() {
    this._walletConnection.signOut();
    this._accountId = null;
    this.setState({
      signedIn: !!this._accountId,
      accountId: this._accountId,
    })
  }

  async alphaColorChange(c) {
    this.setState({
      alpha: c.rgb.a,
    }, () => {
      this.changeColor(c, c.rgb.a)
    });
  }

  hueColorChange(c) {
    this.setState({
      gammaColors: generateGamma(c.hsl.h)
    })
    this.changeColor(c)
  }

  saveColor() {
    const newColor = intToColor(this.state.currentColor);
    const index = this.state.colors.indexOf(newColor);
    if (index >= 0) {
      this.state.colors.splice(index, 1);
    }
    this.setState({
      colors: [newColor].concat(this.state.colors).slice(0, MaxNumColors)
    });
  }

  changeColor(c, alpha) {
    alpha = alpha || 1.0;
    const currentColor = c.rgb.r * 0x010000 + c.rgb.g * 0x000100 + c.rgb.b;
    c.hex = intToColorWithAlpha(currentColor, alpha);
    c.rgb.a = alpha;
    c.hsl.a = alpha;
    c.hsv.a = alpha;
    this.setState({
      pickerColor: c,
      alpha,
      currentColor,
    }, () => {
      this.renderCanvas();
    })
  }

  async buyTokens(amount) {
    const requiredBalance = PixelPrice.muln(amount);
    await this._contract.buy_tokens({}, new BN("30000000000000"), requiredBalance);
  }

  depositFt() {
    this.setState({
      showDepositDialog: true
    })
  }

  withdrawFt() {
    this.setState({
      showWithdrawDialog: true
    })
  }

  setHover(accountIndex, v) {
    if (v) {
      this.setState({
        highlightedAccountIndex: accountIndex,
      }, () => {
        this.renderCanvas();
      })
    } else if (this.state.highlightedAccountIndex === accountIndex) {
      this.setState({
        highlightedAccountIndex: -1,
      }, () => {
        this.renderCanvas();
      })
    }
  }

  render() {
    const content = !this.state.connected ? (
        <div>Connecting... <span className="spinner-grow spinner-grow-sm" role="status" aria-hidden="true" /></div>
    ) : (this.state.signedIn ? (
        <div>
          <div className="float-right">
            <button
              className="btn btn-outline-secondary"
              onClick={() => this.logOut()}>Log out ({this.state.accountId})</button>
          </div>
          <div className="your-balance">
            Balance: <Balance
              account={this.state.account}
              pendingPixels={this.state.pendingPixels}
              detailed={true}
          />
          </div>
          <div className="buttons">
            <button
              className="btn btn-primary"
              onClick={() => this.depositFt()}>Deposit FT
            </button>{' '}
            <button
              className="btn btn-primary"
              onClick={() => this.withdrawFt()}>Withdraw FT
            </button>{' '}
            <button
              className="btn btn-primary"
              onClick={() => this.addLiquidity()}>Add Liquidity
            </button>{' '}
            <button
              className="btn btn-primary"
              onClick={() => this.removeLiquidity()}>Remove Liquidity
            </button>{' '}
          </div>
          <div className="color-picker">
            <HuePicker color={ this.state.pickerColor } width="100%" onChange={(c) => this.hueColorChange(c)}/>
            <GithubPicker className="circle-picker" colors={this.state.gammaColors} color={ this.state.pickerColor } triangle='hide' width="100%" onChangeComplete={(c) => this.changeColor(c)}/>
            <GithubPicker className="circle-picker" colors={this.state.colors} color={ this.state.pickerColor } triangle='hide' width="100%" onChangeComplete={(c) => this.hueColorChange(c)}/>
          </div>
        </div>
    ) : (
        <div style={{marginBottom: "10px"}}>
          <button
              className="btn btn-primary"
              onClick={() => this.requestSignIn()}>Log in with NEAR Wallet</button>
        </div>
    ));
    return (
      <div>
        <div class="header">
          <h2>Wonderland</h2>{' '}
          {content}
        </div>
        <div className="container">
          <div className="row">
            <div>
              <div>
                <canvas ref={this.canvasRef}
                        width={600}
                        height={600}
                        className={this.state.boardLoaded ? "pixel-board" : "pixel-board c-animated-background"}>

                </canvas>
              </div>
            </div>
            <div className="leaderboard">
              <div>
                <Leaderboard
                  owners={this.state.owners}
                  accounts={this.state.accounts}
                  setHover={(accountIndex, v) => this.setHover(accountIndex, v)}
                  selectedOwnerIndex={this.state.selectedOwnerIndex}
                  highlightedAccountIndex={this.state.highlightedAccountIndex}
                />
              </div>
            </div>
          </div>
        </div>
        <a className="github-fork-ribbon right-bottom fixed" href="https://github.com/evgenykuzyakov/wonderland" data-ribbon="Fork me on GitHub"
           title="Fork me on GitHub">Fork me on GitHub</a>
      </div>
    );
  }
}

const Balance = (props) => {
  const account = props.account;
  if (!account) {
    return "";
  }
  const fraction = props.detailed ? 3: 1;
  return (
    <span className="balances font-small">
      <span className="font-weight-bold">{account.ftBalance.toFixed(fraction)}</span>{' '}FT{' '}
      <span className="font-weight-bold">{account.lBalance.toFixed(fraction)}</span>{' '}Liq{' '}
      {
        props.pendingPixels ? <span> ({props.pendingPixels} pending)</span> : ""
      }
    </span>
  );
};

const Leaderboard = (props) => {
  const owners = props.owners.map((owner) => {
    if (owner.accountIndex in props.accounts) {
      owner.account = props.accounts[owner.accountIndex];
    }
    return <Owner
      key={owner.accountIndex}
      {...owner}
      isSelected={owner.accountIndex === props.selectedOwnerIndex}
      setHover={(v) => props.setHover(owner.accountIndex, v)}
      isHighlighted={owner.accountIndex === props.highlightedAccountIndex}
    />
  })
  return (
    <table className="table table-hover table-sm"><tbody>{owners}</tbody></table>
  );
};

const Owner = (props) => {
  const account = props.account;
  return (
    <tr onMouseEnter={() => props.setHover(true)}
        onMouseLeave={() => props.setHover(false)}
        className={props.isSelected ? "selected" : ""}>
      <td>
        {account ? <Account accountId={account.accountId} /> : "..."}
      </td>
      <td className="text-nowrap">
        <small>
          <Balance account={account} />
        </small>
      </td>
    </tr>
  )
}

const Account = (props) => {
  const accountId = props.accountId;
  const shortAccountId = (accountId.length > 6 + 6 + 3) ?
    (accountId.slice(0, 6) + '...' + accountId.slice(-6)) :
    accountId;
  return <a className="account"
            href={`https://explorer.near.org/accounts/${accountId}`}>{shortAccountId}</a>
}

export default App;
