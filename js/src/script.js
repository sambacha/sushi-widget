import _camelCase from 'lodash/camelCase';
import _keyBy from 'lodash/keyBy';
import _bindAll from 'lodash/bindAll';
import _memoize from 'lodash/memoize';
import _orderBy from 'lodash/orderBy';
import bign from 'big.js';
import * as qs from './qs';
import debug from './debug';

const INFURA_ID = process.env.INFURA_ID;
const IFRAME_HOST = process.env.IFRAME_HOST;
const PRECISION = 4;
const ETH_ONE_INCH_ADDR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SLIPPAGE = 1;
const FAVORITE_TOKENS = [
  'ETH',
  'DAI',
  'UNI',
  'AAVE',
  'YFI',
  'BAND',
  'LINK',
  'CHI',
  'WETH',
];

window.oneInch = function(options) {
  debug('swap');
  const swap = new Swap(options);
  return () => swap.close.call(swap);
};

class Swap {
  constructor(options) {
    _bindAll(this, 'handleMessage');
    this.getAssetCoinGeckoId = _memoize(this.getAssetCoinGeckoIdMemoized);

    this.options = options;
    this.sid = Date.now();
    this.handleMessages();
    this.createIframe();
  }

  handleMessages() {
    if (window.addEventListener) {
      window.addEventListener('message', this.handleMessage, false);
    } else {
      window.attachEvent('onmessage', this.handleMessage);
    }
  }

  close() {
    if (window.removeEventListener) {
      window.removeEventListener('message', this.handleMessage, false);
    } else {
      window.detachEvent('onmessage', this.handleMessage);
    }

    document.body.removeChild(this.iframe);
  }

  handleMessage(evt) {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    debug('msg: %s', msg.sid);
    if (parseInt(msg.sid) !== parseInt(this.sid)) {
      return debug('ignoring msg(%s) self(%s)', msg.sid, this.sid);
    }
    debug('msg %o', msg);
    const meth = _camelCase('on-' + msg.type);
    if (!this[meth]) return debug('unknown msg type %s', meth);
    this[meth](msg.sid, msg.payload);
  }

  postMessageToIframe(sid, type, payload = {}) {
    this.iframe.contentWindow.postMessage(
      JSON.stringify({ type, payload, sid }),
      IFRAME_HOST
    );
  }

  validateOptions({ toEthereum, toTokenAddress, defaultAmount }) {
    // todo: validate `toTokenAddress`

    // validate `defaultAmount`
    defaultAmount = Number(defaultAmount);
    if (defaultAmount <= 0) throw new Error('invalid default amount');

    return {
      toEthereum,
      toTokenAddress,
      defaultAmount,
    };
  }

  createIframe() {
    const { sid, options } = this;

    try {
      const url =
        IFRAME_HOST +
        '?' +
        qs.stringify({
          options: btoa(
            JSON.stringify({
              sid,
              host: location.origin,
              ...this.validateOptions(options),
            })
          ),
        });

      debug(url);

      const iframe = (this.iframe = document.createElement('iframe'));
      iframe.setAttribute('src', url);
      iframe.style.display = 'flex';
      iframe.style.position = 'fixed';
      iframe.style.top = '0';
      iframe.style.left = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style['z-index'] = '1000000000';
      // iframe.style.opacity = '0';
      // iframe.style['pointer-events'] = 'none';

      document.body.appendChild(iframe);
    } catch (e) {
      this.options.onError && this.options.onError(e);
    }
  }

  getSigner() {
    return this.ethersWallet || this.defaultProvider;
  }

  async getERC20Contract(address) {
    const erc20Abi = await import('./abis/erc20.json');
    return new this.ethers.Contract(address, erc20Abi, this.getSigner());
  }

  toFixed(a, b) {
    if (this.isZero(bign(a)) || this.isZero(bign(b))) {
      return '0';
    }
    return bign(a.toString())
      .div(bign(b.toString()))
      .toFixed(PRECISION);
  }

  formatUnits(a, decimals) {
    return this.toFixed(a.toString(), bign(10).pow(decimals));
  }

  isZero(a) {
    return a.eq(bign('0'));
  }

  // bn.js
  bn(a) {
    return this.ethers.BigNumber.from(a.toString());
  }

  async getQuote({ fromAssetAddress, toAssetAddress, fromAssetAmount }) {
    const { toTokenAmount, estimatedGas } = await request(
      'https://api.1inch.exchange/v2.0/quote',
      {
        fromTokenAddress: fromAssetAddress,
        toTokenAddress: toAssetAddress,
        amount: fromAssetAmount.toString(),
      }
    );
    return {
      toAssetAmount: this.bn(toTokenAmount),
      estimatedGas,
    };
  }

  async getQuoteStats({
    fromAssetAddress,
    fromAssetDecimals,
    fromAssetAmount,

    toAssetAddress,
    toAssetDecimals,
    toAssetAmount,
  }) {
    const assetsCoinGeckoIds = await Promise.all(
      [fromAssetAddress, toAssetAddress].map(this.getAssetCoinGeckoId)
    );
    const prices = await request(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        ids: assetsCoinGeckoIds.join(','),
        vs_currencies: 'usd',
      }
    );
    debug('%o %o', assetsCoinGeckoIds, prices);

    const fromAssetUsd = this.getAssetAmountToUSD({
      assetAddress: fromAssetAddress,
      assetDecimals: fromAssetDecimals,
      amount: fromAssetAmount,
      usd: prices[assetsCoinGeckoIds[0]].usd,
    });
    const toAssetUsd = this.getAssetAmountToUSD({
      assetAddress: toAssetAddress,
      assetDecimals: toAssetDecimals,
      amount: toAssetAmount,
      usd: prices[assetsCoinGeckoIds[1]].usd,
    });

    return {
      fromAssetUsd,
      toAssetUsd,

      feeUSD: '-',
      feeIsHigh: false,
      priceImpact: '-', // '<0.01%',
      priceImpactIsHigh: false,
    };
  }

  async getAssetCoinGeckoIdMemoized(assetAddress) {
    return isEth(assetAddress)
      ? 'ethereum'
      : (
          await request(
            `https://api.coingecko.com/api/v3/coins/ethereum/contract/${assetAddress}`
          )
        ).id;
  }

  getAssetAmountToUSD({ assetAddress, assetDecimals, amount, usd }) {
    return this.formatUnits(
      bign(amount.toString()).mul(bign(usd.toString())),
      assetDecimals
    );
  }

  // messages from js

  async onError(sid, error) {
    this.options.onError(new Error(error));
  }

  onCancel() {
    this.close();
    this.options.onCancel && this.options.onCancel();
  }

  async onIframeLoad(sid, { toEthereum, toTokenAddress }) {
    const [
      { ethers },
      { tokens },
      { address: spenderAddress },
    ] = await Promise.all([
      import('ethers'),
      request('https://api.1inch.exchange/v2.0/tokens'),
      request('https://api.1inch.exchange/v2.0/approve/spender'),
    ]);

    this.ethers = ethers;
    this.defaultProvider = new ethers.providers.InfuraProvider(
      'homestead',
      INFURA_ID
    );

    const toAsset = {};
    if (toEthereum) {
      toAsset.symbol = 'ETH';
      toAsset.address = ETH_ONE_INCH_ADDR;
      toAsset.decimals = 18;
      toAsset.isETH = true;
    } else {
      const erc20Contract = await this.getERC20Contract(toTokenAddress);
      toAsset.address = toTokenAddress;
      toAsset.symbol = (await erc20Contract.symbol()).toUpperCase();
      toAsset.decimals = await erc20Contract.decimals();
    }

    const favoriteTokens = {};
    const fromAssets = [];
    for (const address in tokens) {
      const { name, symbol, decimals } = tokens[address];
      const fromAsset = {
        name,
        symbol,
        address,
        decimals,
      };
      if (~FAVORITE_TOKENS.indexOf(symbol)) {
        favoriteTokens[symbol] = fromAsset;
      } else {
        fromAssets.push(fromAsset);
      }
    }

    this.spenderAddress = spenderAddress;

    this.postMessageToIframe(sid, 'iframe-load', {
      fromAssets: [
        ...FAVORITE_TOKENS.map(symbol => favoriteTokens[symbol]),
        ..._orderBy(fromAssets, 'symbol'),
      ],
      toAsset,
    });
  }

  async onConnectMetamask(sid) {
    if (!window.ethereum) {
      return alert('Please install Metamask extension'); // todo: better error message or hide option
    }
    this.connectProvider(sid, window.ethereum);
  }

  async onConnectWalletConnect(sid) {
    const { default: WalletConnectProvider } = await import(
      '@walletconnect/web3-provider'
    );
    this.connectProvider(
      sid,
      new WalletConnectProvider({
        infuraId: INFURA_ID,
      })
    );
  }

  async connectProvider(sid, web3Provider) {
    await web3Provider.enable();
    this.web3Provider = web3Provider;

    web3Provider.on('accountsChanged', () => {});
    web3Provider.on('chainChanged', () => {});

    this.ethersProvider = new this.ethers.providers.Web3Provider(web3Provider);

    this.ethersWallet = this.ethersProvider.getSigner();

    const address = (this.address = await this.ethersWallet.getAddress());
    this.postMessageToIframe(sid, 'connect', { address });
  }

  async onDisconnectWallet(sid) {
    await this.web3Provider?.disconnect?.();

    this.ethersProvider = null;
    this.ethersWallet = null;
    this.address = null;

    this.postMessageToIframe(sid, 'disconnect');
  }

  async onGetInitialQuote(
    sid,
    {
      fromAssetAddress,
      toAssetDecimals,
      fromAssetDecimals,
      toAssetAddress,
      toAssetAmount,
    }
  ) {
    toAssetAmount = this.ethers.utils.parseUnits(
      toAssetAmount.toString(),
      toAssetDecimals
    );

    const { toAssetAmount: fromAssetAmount } = await this.getQuote({
      fromAssetAddress: toAssetAddress,
      toAssetAddress: fromAssetAddress,
      fromAssetAmount: toAssetAmount,
    });

    const rate = this.toFixed(toAssetAmount, fromAssetAmount);

    this.postMessageToIframe(sid, 'get-quote', {
      fromAssetAmount: this.formatUnits(fromAssetAmount, fromAssetDecimals),
      toAssetAmount: this.formatUnits(toAssetAmount, toAssetDecimals),
      rate,
      ...(await this.getQuoteStats({
        fromAssetAddress,
        fromAssetDecimals,
        fromAssetAmount,

        toAssetAddress,
        toAssetDecimals,
        toAssetAmount,
      })),
    });
  }

  async onGetQuote(
    sid,
    {
      fromAssetAddress,
      toAssetDecimals,
      fromAssetDecimals,
      toAssetAddress,
      fromAssetAmount,
    }
  ) {
    fromAssetAmount = this.ethers.utils.parseUnits(
      fromAssetAmount.toString(),
      fromAssetDecimals
    );

    const { toAssetAmount } = await this.getQuote({
      fromAssetAddress,
      toAssetAddress,
      fromAssetAmount,
    });

    const rate = this.toFixed(toAssetAmount, fromAssetAmount);

    let hasSufficientBalance = false;
    let approve = false;
    let balance;

    if (this.address) {
      if (isEth(fromAssetAddress)) {
        balance = await this.ethersWallet.getBalance();
      } else {
        const fromAssetContract = await this.getERC20Contract(fromAssetAddress);
        balance = await fromAssetContract.balanceOf(this.address);
        const allowance = await fromAssetContract.allowance(
          this.address,
          this.spenderAddress
        );
        approve = fromAssetAmount.gt(allowance);
      }

      hasSufficientBalance = balance.gte(fromAssetAmount);

      debug('approval required: %s', approve);
      debug('has sufficient balance: %s', hasSufficientBalance);
    }

    this.postMessageToIframe(sid, 'get-quote', {
      fromAssetAmount: this.formatUnits(fromAssetAmount, fromAssetDecimals),
      toAssetAmount: this.formatUnits(toAssetAmount, toAssetDecimals),
      rate,
      fromAssetBalance: !balance
        ? null
        : this.formatUnits(balance, fromAssetDecimals),
      hasSufficientBalance,
      approve,
      ...(await this.getQuoteStats({
        fromAssetAddress,
        fromAssetDecimals,
        fromAssetAmount,

        toAssetAddress,
        toAssetDecimals,
        toAssetAmount,
      })),
    });
  }

  async onApprove(
    sid,
    { fromAssetAddress, fromAssetDecimals, fromAssetAmount }
  ) {
    fromAssetAmount = this.ethers.utils
      .parseUnits(fromAssetAmount.toString(), fromAssetDecimals)
      .mul(101)
      .div(100);

    const fromAssetContract = await this.getERC20Contract(fromAssetAddress);
    try {
      const tx = await fromAssetContract.approve(
        this.spenderAddress,
        fromAssetAmount
      );
      await tx.wait();
      this.postMessageToIframe(sid, 'approve');
    } catch (err) {
      console.error(err);
      this.postMessageToIframe(sid, 'error', err);
    }
  }

  async onSwap(
    sid,
    {
      fromAssetAddress,
      fromAssetDecimals,
      toAssetAddress,
      toAssetDecimals,
      fromAssetAmount,
      address,
    }
  ) {
    fromAssetAmount = this.ethers.utils.parseUnits(
      fromAssetAmount.toString(),
      fromAssetDecimals
    );

    try {
      const {
        tx: {
          from,
          to,
          data,
          value,
          // gasPrice,
          // gas
        },
      } = await request('https://api.1inch.exchange/v2.0/swap', {
        fromTokenAddress: fromAssetAddress,
        toTokenAddress: toAssetAddress,
        amount: fromAssetAmount.toString(),
        fromAddress: this.address,
        slippage: SLIPPAGE,
      });
      const tx = await this.ethersWallet.sendTransaction({
        from,
        to,
        data,
        value: this.bn(value),
        // gasPrice,
        // gas
      });
      this.postMessageToIframe(sid, 'swap', {
        transactionHash: tx.hash,
      });
    } catch (err) {
      console.error(err);
      this.postMessageToIframe(sid, 'error', err);
    }
  }

  async onComplete(sid, { transactionHash }) {
    if (this.options.onSwap) {
      this.options.onSwap(transactionHash);
    } else {
      this.close();
    }
  }
}

async function request(url, query) {
  if (query) {
    url += '?' + qs.stringify(query);
  }
  return await (await fetch(url)).json();
}

function isEth(addr) {
  return addr.toLowerCase() === ETH_ONE_INCH_ADDR;
}
