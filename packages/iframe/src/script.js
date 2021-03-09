import _debounce from 'lodash/debounce';
import _camelCase from 'lodash/camelCase';
import _bindAll from 'lodash/bindAll';
import debug from './debug';
import * as qs from './qs';
import * as dom from './dom';

const WALLET_CACHE_KEY = 'WEB3_CONNECTED_PROVIDER';

window.onload = () => new Swap();

class Swap {
  constructor() {
    const querystring = qs.parse(window.location.search.substring(1));
    this.props = JSON.parse(atob(unescape(querystring.options)));
    debug('props %o', this.props);

    this.addressLabel = document.getElementById('address');
    this.form = document.querySelector('form');
    this.button = document.querySelector('button');
    this.close = document.getElementById('close');
    this.loader = document.getElementById('boot-loader-container');

    this.fromAssetContainer = document.querySelector('.from-asset');
    this.fromAssetAmountInput = this.fromAssetContainer.querySelector('input');
    this.fromAssetButton = document.getElementById('from-asset-button');
    this.fromAssetDropdown = document.getElementById('from-asset-dropdown');
    this.fromAssetDropdownInput = document.getElementById(
      'from-asset-dropdown-input'
    );
    this.fromAssetDropdownList = document.getElementById(
      'from-asset-dropdown-list'
    );
    this.fromBalance = document.getElementById('from-balance');
    this.fromAssetUSDEstimate = this.fromAssetContainer.querySelector('.usd');

    this.toAssetContainer = document.querySelector('.to-asset');
    this.toAssetAmountInput = this.toAssetContainer.querySelector('input');
    this.toAssetButton = document.getElementById('to-asset-button');
    this.toAssetUSDEstimate = this.toAssetContainer.querySelector('.usd');

    this.quoteRate = document.getElementById('quote-rate');
    this.quotePriceImpact = document.getElementById('quote-price-impact');
    this.quoteFee = document.getElementById('quote-fee');

    this.walletsContainer = document.getElementById('wallets');
    this.metamaskEl = document.getElementById('metamask');
    this.walletConnectEl = document.getElementById('wallet-connect');

    this.setUpEventHandlers();
    this.load();
  }

  setUpEventHandlers() {
    _bindAll(this, 'handleMessage', 'handleAssetChange');
    this.getQuote = _debounce(this.getQuoteDebounced.bind(this), 100);
    this.handleFilterFromAssetDropdown = _debounce(
      this.handleFilterFromAssetDropdownDebounced.bind(this),
      100
    );

    this.handleMessages();

    this.fromAssetAmountInput.oninput = e => this.handleAmountChange(e);
    this.fromAssetButton.onclick = e => this.handleShowFromAssetDropdown(e);
    this.fromAssetDropdownInput.oninput = e =>
      this.handleFilterFromAssetDropdown();

    this.form.onsubmit = e => this.connectWalletOrApproveOrSwap(e);

    this.close.onclick = () => this.postMessageToParentWindow('cancel');

    this.addressLabel.querySelector('.disconnect').onclick = () =>
      this.postMessageToParentWindow('disconnectWallet');

    this.handleCloseAssetsDropdown();

    this.metamaskEl.onclick = () => {
      this.web3ProviderName = 'metamask';
      this.postMessageToParentWindow('connect-metamask');
    };
    this.walletConnectEl.onclick = () => {
      this.web3ProviderName = 'wallet-connect';
      this.postMessageToParentWindow('connect-wallet-connect');
    };
  }

  handleCloseAssetsDropdown() {
    window.onclick = event => {
      if (!event.target.matches('.js-dropdown')) {
        this.closeAssetsDropdown();
      }
    };
  }

  closeAssetsDropdown() {
    dom.hide(this.fromAssetDropdown);
  }

  handleAmountChange(e) {
    this.fromAssetAmount = parseFloat(e.target.value);
    if (!this.fromAssetAmount) {
      this.toAssetAmountInput.value = '0';
      return;
    }
    this.getQuote();
  }

  handleShowFromAssetDropdown() {
    if (this.working) return;
    this.fromAssetDropdownInput.value = '';
    this.handleFilterFromAssetDropdown();
    dom.show(this.fromAssetDropdown);
  }

  handleFilterFromAssetDropdownDebounced() {
    const els = document.createDocumentFragment();
    const queryTerm = (this.fromAssetDropdownInput.value || '')
      .trim()
      .toLowerCase();
    this.fromAssets.forEach((asset, index) => {
      if (
        asset.symbol !== this.toAsset.symbol &&
        (!queryTerm || ~asset.name.toLowerCase().indexOf(queryTerm))
      ) {
        const el = document.createElement('div');
        el.dataset.index = index;
        el.innerText = `${asset.name} (${asset.symbol})`;
        el.style.cursor = 'pointer';
        el.classList.add('js-dropdown');
        el.onclick = this.handleAssetChange;
        els.appendChild(el);
      }
    });
    this.fromAssetDropdownList.innerHTML = '';
    this.fromAssetDropdownList.appendChild(els);
  }

  handleAssetChange(e) {
    const { index } = e.target.dataset;
    this.fromAsset = this.fromAssets[parseInt(index)];
    this.fromAssetButton.innerText = this.fromAsset.symbol;
    this.closeAssetsDropdown();
    this.getQuote();
  }

  handleMessages() {
    if (window.addEventListener) {
      window.addEventListener('message', this.handleMessage, false);
    } else {
      window.attachEvent('onmessage', this.handleMessage);
    }
  }

  async handleMessage(evt) {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    debug('msg: %s', msg.sid);
    if (parseInt(msg.sid) !== parseInt(this.props.sid)) {
      return debug('ignoring msg(%s) self(%s)', msg.sid, this.props.sid);
    }
    debug('msg %o', msg);
    const meth = _camelCase('on-' + msg.type);
    if (!this[meth]) return debug('unknown msg type %s', meth);
    this[meth](msg.payload);
  }

  postMessageToParentWindow(type, payload = {}) {
    window.top.postMessage(
      JSON.stringify({ type, payload, sid: this.props.sid }),
      this.props.host
    );
  }

  load() {
    this.postMessageToParentWindow('iframe-load', this.props);
  }

  setIsWorking(text) {
    const working = (this.working = !!text);
    dom.attr(this.fromAssetAmountInput, 'disabled', working);
    dom.attr(this.button, 'disabled', working);
    if (working) {
      this.setButtonText(text);
    }
  }

  connectWalletOrApproveOrSwap(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!this.address) {
      this.web3ProviderName = window.localStorage.getItem(WALLET_CACHE_KEY);
      if (this.web3ProviderName) {
        debug(`connecting to ${this.web3ProviderName}..`);
        this.postMessageToParentWindow(`connect-${this.web3ProviderName}`);
      } else {
        debug('showing wallets..');
        dom.show(this.walletsContainer);
        dom.hide(this.button);
      }
    } else if (this.approve) {
      debug('approving..');
      this.setIsWorking('Approving..');
      this.postMessageToParentWindow('approve', {
        fromAssetAddress: this.fromAsset.address,
        fromAssetDecimals: this.fromAsset.decimals,
        fromAssetAmount: this.fromAssetAmount,
      });
    } else {
      debug('swaping..');
      this.setIsWorking('Swaping..');
      this.postMessageToParentWindow('swap', {
        fromAssetAddress: this.fromAsset.address,
        fromAssetDecimals: this.fromAsset.decimals,
        toAssetAddress: this.toAsset.address,
        toAssetDecimals: this.toAsset.decimals,
        fromAssetAmount: this.fromAssetAmount,
        address: this.address,
      });
    }
  }

  setButtonText(text) {
    this.button.innerHTML = text;
  }

  getQuoteDebounced() {
    this.postMessageToParentWindow('get-quote', {
      fromAssetAddress: this.fromAsset.address,
      fromAssetDecimals: this.fromAsset.decimals,
      toAssetAddress: this.toAsset.address,
      toAssetDecimals: this.toAsset.decimals,
      fromAssetAmount: this.fromAssetAmount,
    });
  }

  // events from iframe

  onError(err) {
    debug('received error: %s', err.message); // todo display error to user
    this.setIsWorking(false);
    this.getQuote();
  }

  onIframeLoad({ fromAssets, toAsset }) {
    this.fromAssets = fromAssets;
    for (let i = 0; i < fromAssets.length; i++) {
      const fromAsset = fromAssets[i];
      if (fromAsset.symbol !== toAsset.symbol) {
        this.fromAssetButton.innerText = fromAsset.symbol;
        this.fromAsset = fromAsset;
        break;
      }
    }

    this.toAsset = toAsset;
    this.toAssetButton.innerHTML = this.toAsset.symbol;
    this.toAssetAmountInput.value = this.toAsset.symbol;

    dom.hide(this.loader);
    dom.show(this.form);

    // get initial quote in the reverse
    const toAssetAmount = this.props.defaultAmount || 1;
    this.postMessageToParentWindow('get-initial-quote', {
      fromAssetAddress: this.fromAsset.address,
      fromAssetDecimals: this.fromAsset.decimals,
      toAssetAddress: toAsset.address,
      toAssetDecimals: toAsset.decimals,
      toAssetAmount,
    });
  }

  onConnect({ address }) {
    window.localStorage.setItem(WALLET_CACHE_KEY, this.web3ProviderName);
    dom.hide(this.walletsContainer);
    dom.show(this.button);

    this.address = address;
    debug('connected', address);
    dom.show(this.addressLabel, 1);
    this.addressLabel.querySelector('.address').innerText = `${address.slice(
      0,
      6
    )}....${address.slice(-4)}`;
    dom.show(this.fromBalance);
    this.getQuote();
  }

  onDisconnect() {
    window.localStorage.removeItem(WALLET_CACHE_KEY);
    this.address = null;
    dom.hide(this.addressLabel);
    dom.hide(this.fromBalance);
    this.getQuote();
  }

  onGetQuote({
    fromAssetAmount,
    fromAssetUsd,
    toAssetUsd,
    toAssetAmount,
    fromAssetBalance,
    rate,
    approve,
    hasSufficientBalance,
    feeUSD,
    feeIsHigh,
    priceImpact,
    priceImpactIsHigh,
  }) {
    if (!this.fromAssetAmount) {
      this.fromAssetAmountInput.value = this.fromAssetAmount = fromAssetAmount;
    }
    this.fromAssetUSDEstimate.innerText = `≈ $${fromAssetUsd}`;

    if (this.address) {
      this.fromBalance.querySelector('span').innerText = fromAssetBalance;
    }

    this.toAssetAmountInput.value = toAssetAmount;
    this.toAssetUSDEstimate.innerText = `≈ $${toAssetUsd}`;

    this.quoteRate.innerText = `1 ${this.fromAsset.symbol} = ${rate} ${this.toAsset.symbol}`;
    this.quotePriceImpact.innerText = priceImpact;
    this.quotePriceImpact.classList.add(priceImpactIsHigh ? 'red' : 'green');
    this.quoteFee.innerText = `≈ $${feeUSD}`;
    this.quoteFee.classList.add(feeIsHigh ? 'red' : 'green');

    this.approve = approve;
    dom.attr(this.button, 'disabled', this.address && !hasSufficientBalance);

    if (!this.address) {
      this.setButtonText('Connect Wallet');
    } else if (!hasSufficientBalance) {
      this.setButtonText('Insufficent Balance');
    } else if (approve) {
      this.setButtonText(`Approve ${this.fromAsset.symbol}`);
    } else if (this.address) {
      this.setButtonText('Swap →');
    }
  }

  async onApprove() {
    this.setIsWorking(false);
    this.getQuote();
  }

  async onSwap(props) {
    this.setIsWorking(false);
    this.setButtonText(
      'Swaped <span class="pl-2" style="font-family: none;">✓</span>'
    );
    await sleep(3000);
    this.postMessageToParentWindow('complete', props);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
