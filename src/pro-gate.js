'use strict';
// Zovo Pro gate for one extension (lane PRO4), on top of the shared license facade in src/license (copied unchanged
// from factory/sprint/license). The product file (src/pro.js) gives the feature names and texts.
// Rules (PAYWALL1, PRICE1 section 3):
// - Nothing about Pro shows when a file opens: no popup, no toast, no counter.
// - Every Pro feature works TRIAL_USES times on this computer first. A try is used only when the feature has run or
//   saved its file, so cancelling a dialog or pressing Escape costs nothing.
// - After the tries, a click on the feature shows one modal (started by the user) with the ways to unlock.
// - No network, except what the user starts: the GitHub Sponsors unlock, or a page opened in the browser.
// - <prefix>.showProFeatures = false hides the Pro buttons and commands, unless a license is active.

const TRIAL_USES = 3;
const PRICE_LINE = 'Zovo Pro is USD 19 once and unlocks the Pro features in every Zovo viewer. Already bought the "$19 one time" tier on GitHub Sponsors? Choose Unlock with GitHub Sponsors: it asks GitHub one question and sends nothing else. No GitHub account? Send USD 19 to paypal.com/paypalme/najzzz/19 with "Zovo Pro" in the note, and you get a license key by email.';

function createProGate(o) {
  const { vscode, context, sku, prefix, product, features, freeLine } = o;
  const enabled = o.enabled !== false;
  const lic = o.license || o.createLicense({ vscode, context, sku, name: 'Zovo', commandPrefix: prefix });
  const trialKey = prefix + '.proTrial';
  const trials = () => Object.assign({}, context.globalState.get(trialKey) || {});
  const used = (f) => Number(trials()[f]) || 0;
  const left = (f) => (features[f] ? Math.max(0, TRIAL_USES - used(f)) : 0);
  const licensed = () => { try { return !!lic.isPro(sku); } catch (e) { return false; } };
  const isPro = () => !enabled || licensed();
  const shown = () => !enabled || licensed() || vscode.workspace.getConfiguration(prefix).get('showProFeatures', true) !== false;

  function label(f) {
    if (isPro() || !features[f]) return '';
    const n = left(f);
    return n > 0 ? `Pro, ${n} free ${n === 1 ? 'try' : 'tries'}` : 'Pro';
  }

  async function explain(f) {
    const ft = features[f];
    const tried = used(f) >= TRIAL_USES ? `You have used the ${TRIAL_USES} free tries of ${ft.title.toLowerCase()} on this computer.\n\n` : '';
    return lic.requirePro(ft.title, tried + ft.detail + '\n\n' + PRICE_LINE + '\n\n' + freeLine);
  }

  /** May the feature start now? True with a license or a free try left (the try is not used yet). Else the modal. */
  async function allow(f) {
    if (!features[f]) return false;
    if (isPro()) { if (enabled) lic.refresh(); return true; }
    if (left(f) > 0) return true;
    return explain(f);
  }

  /** The feature ran or saved its file: use one free try when there is no license. Returns the tries left. */
  async function use(f) {
    if (!features[f] || isPro()) return Infinity;
    const m = trials();
    m[f] = used(f) + 1;
    await context.globalState.update(trialKey, m);
    const n = left(f);
    vscode.window.setStatusBarMessage(`${product}: free try of ${features[f].title.toLowerCase()} used, ${n} left on this computer.`, 6000);
    return n;
  }

  /** What the webview needs to draw the Pro buttons. */
  function view() {
    const out = {};
    for (const f of Object.keys(features)) out[f] = { label: label(f), left: left(f), title: features[f].title };
    return { shown: shown(), pro: isPro(), features: out };
  }

  const setContext = () => vscode.commands.executeCommand('setContext', prefix + '.proLicensed', licensed()).then(undefined, () => {});
  setContext();
  if (lic.ready && lic.ready.then) lic.ready.then(setContext, () => {});
  lic.onDidChange(() => setContext());

  return {
    enabled, TRIAL_USES, PRICE_LINE,
    allow, use, left, label, view, shown, isPro, licensed,
    ready: lic.ready,
    onDidChange: (fn) => lic.onDidChange(fn),
    handleUri: (uri) => lic.handleUri(uri),
    license: lic,
  };
}

module.exports = { createProGate, TRIAL_USES, PRICE_LINE };
