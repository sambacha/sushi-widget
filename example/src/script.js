import debug from './debug';

debug('boot');

const TOKENS = {
  DAI: '0x6b175474e89094c44da98b954eedeac495271d0f',
  UNI: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
};

let notification;
let button;
let select;
window.onload = onLoad;

function onLoad() {
  showExampleCode();

  notification = document.querySelector('.notification');

  select = document.querySelector('select');

  button = document.querySelector('button');
  button.onclick = onStartSwap;
}

function onStartSwap(e) {
  e.preventDefault();
  e.stopPropagation();

  const asset = select.value;
  debug('swaping %s ..', asset);

  const close = window.oneInch({
    ...('ETH' === asset
      ? { toEthereum: true }
      : {
          toTokenAddress: TOKENS[asset],
        }),
    defaultAmount: 1,
    async onSwap(transactionHash) {
      close();
      debug('bought %s!', transactionHash);
      await notify('success', 'Done!', 'Waiting for transaction to be mined..');
    },
    onError(e) {
      close();
      debug('charge error %s', e.message);
      notify('error', 'An unexpected error occured.', e.message);
    },
    onCancel() {
      debug('user cancelled swap');
    },
  });
}

async function notify(type, title, message) {
  const [titleEl, messageEl] = notification.querySelectorAll('div');
  titleEl.innerText = title;
  messageEl.innerText = message;

  showNotification(type, true);
  await sleep(4000);
  showNotification(type, false);
}

function showNotification(type, show) {
  const types = ['success', 'error'];
  types.forEach(t => {
    notification.classList[t === type ? 'add' : 'remove'](t);
  });
  notification.classList[show ? 'remove' : 'add']('hidden');
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showExampleCode() {
  const jsHost =
    process.env.NODE_ENV === 'production'
      ? 'https://1inch-swap.surge.sh/js/script.js'
      : 'http://localhost:3501/script.js';
  document.querySelector('code').innerText = `
<button id='buy-button'>Buy Token</button>

<script src='${jsHost}'></script>
<script>
  const button = document.getElementById('buy-button');
  button.onclick = function() {
    const closeModal = window.oneInch({
      toTokenAddress: '0x..', // or toEthereum: true,
      defaultAmount: 100,
      onSwap(transactionHash) {
        console.log('bought at %s!', transactionHash);
        closeModal();
      },
    });
  };
</script>`;
}
