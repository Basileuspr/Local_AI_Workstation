import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiUrl } from "../../src/api";
import { StoreProvider } from "../../src/useStore";
import { ImagePrivacyProvider } from "../../src/ImagePrivacy";
import ImageThumbnail, { FileImageThumbnail, ThumbnailRetryButton } from "../../src/components/ImageThumbnail";
import ImageGallery from "../../src/components/ImageGallery";
import FileConverter from "../../src/components/FileConverter";
import FilePackager from "../../src/components/FilePackager";
import { LibraryPicker } from "../../src/components/CharacterStudio";
import WebImageReader from "../../src/components/WebImageReader";
import "../../src/styles.css";

function Fixture() {
  const [images, setImages] = useState([]), [version, setVersion] = useState(0), [picker, setPicker] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { fetch(apiUrl("/fixture/manifest")).then(response => response.json()).then(value => setImages(value.images)); }, []);
  async function fault(kind) {
    await fetch(apiUrl(`/fixture/fault/${kind}`), { method: "POST" });
    if (kind === "images") setVersion(value => value + 1);
    else window.dispatchEvent(new Event("image-library-changed"));
  }
  async function sampleFiles(section) {
    const files = await Promise.all(images.slice(0, 4).map(async image => new File([await (await fetch(apiUrl(image.url))).blob()], image.name, {type:"image/png"})));
    const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
    const node = document.querySelector(`[data-fixture="${section}"] input[type="file"]`);
    node.files = transfer.files; node.dispatchEvent(new Event("change", {bubbles:true}));
  }
  return <main style={{height:"100dvh",overflow:"auto",padding:24,background:"var(--bg-primary)"}}>
    <h1>Thumbnail retrieval preview</h1><p style={{margin:"10px 0",color:"var(--text-dim)"}}>Real image routes with synthetic originals. No user data or inference.</p>
    <div className="tools-toolbar"><ThumbnailRetryButton /><button onClick={() => fault("access")}>Simulate access-check failure</button><button onClick={() => fault("images")}>Simulate thumbnail failure</button><button onClick={() => fault("lock")}>Lock first image</button><button onClick={() => fault("unlock")}>Unlock first image</button><button onClick={() => setPicker(true)}>Character Parts picker</button>
      <button onClick={async () => { const result = await fetch(apiUrl("/image-library/images/a/content").split("?")[0] + "?thumbnail=true"); setMessage(`Without credentials: ${result.status}`); }}>Check credentials</button></div>
    <p role="status">{message}</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:14,margin:"20px 0"}}>{images.map(image => <figure key={image.id} style={{padding:10,border:"1px solid var(--border)",borderRadius:8}}><div style={{height:140}}><ImageThumbnail src={apiUrl(image.url + `?v=${version}`)} alt={image.name} /></div><figcaption>{image.name}</figcaption></figure>)}</div>
    <ImageGallery images={images.slice(1,2).map(image => ({...image,source:"Fixture chat",url:apiUrl(image.url)}))} onImagesRemoved={() => {}} />
    <div data-fixture="converter" style={{height:600,marginTop:24}}><button onClick={() => sampleFiles("converter")}>Load converter sample files</button><FileConverter /></div>
    <div data-fixture="packager" style={{height:650,marginTop:24}}><button onClick={() => sampleFiles("packager")}>Load packager sample files</button><FilePackager /></div>
    <WebImageReader images={images.slice(2,3)} sourceFor={image => apiUrl(image.url)} />
    {picker && <LibraryPicker images={images.map(image => ({...image,url:apiUrl(image.url)}))} onClose={() => setPicker(false)} onImport={() => setPicker(false)} busy={false} />}
  </main>;
}
createRoot(document.getElementById("root")).render(<StoreProvider><ImagePrivacyProvider><Fixture /></ImagePrivacyProvider></StoreProvider>);
