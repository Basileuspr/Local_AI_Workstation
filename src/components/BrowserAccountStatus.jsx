export default function BrowserAccountStatus({identified=false,message='',busy=false,disabled=false,onCheck}) {
  return <div className="browser-account-check">
    <span role="status">{identified?'Signed-in account identified.':message||'Account not identified. Open the website’s account menu so your name or handle is visible, then check again.'}</span>{' '}
    <button disabled={busy||disabled} onClick={onCheck}>Check account</button>
  </div>;
}
