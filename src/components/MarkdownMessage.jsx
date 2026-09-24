import { Fragment, createContext, useContext, useState } from "react";
import ProtectedImage from "../ImagePrivacy";
import { localImageUrl } from "../chatImages";
import ImageViewer from "./ImageViewer";

const ImageClick = createContext(null);
function InlineImage({ text }) {
  const open = useContext(ImageClick), match = text.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/);
  const url = match && localImageUrl(match[2]);
  if (!url) return text;
  const image = { id: url, url, name: match[1] || "Inline image" };
  return <button type="button" className="chat-image-open inline-chat-image" aria-label={`Enlarge ${image.name}`} onClick={() => open?.(image)}><ProtectedImage src={url} alt={image.name} loading="lazy" /></button>;
}

const listPattern = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;
const inlinePattern = /(!\[[^\]\n]*\]\([^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;

function renderInline(value, keyPrefix) {
  const text = String(value || "");
  const parts = text.split(inlinePattern);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!part) return null;
    if (part.startsWith("![")) return <InlineImage key={key} text={part} />;
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>;
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={key}>{renderInline(part.slice(1, -1), key)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function indentSize(value) {
  return value.replace(/\t/g, "  ").length;
}

function readList(lines, startIndex, baseIndent) {
  const firstMatch = lines[startIndex].match(listPattern);
  const ordered = /^\d/.test(firstMatch[2]);
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const match = lines[index].match(listPattern);
    if (!match || indentSize(match[1]) !== baseIndent || /^\d/.test(match[2]) !== ordered) break;

    const item = { content: match[3], child: null };
    index += 1;

    const nextMatch = lines[index]?.match(listPattern);
    if (nextMatch && indentSize(nextMatch[1]) > baseIndent) {
      const child = readList(lines, index, indentSize(nextMatch[1]));
      item.child = child.node;
      index = child.index;
    }
    items.push(item);
  }

  const List = ordered ? "ol" : "ul";
  return {
    index,
    node: (
      <List>
        {items.map((item, itemIndex) => (
          <li key={itemIndex}>
            {renderInline(item.content, `list-${startIndex}-${itemIndex}`)}
            {item.child}
          </li>
        ))}
      </List>
    ),
  };
}

export default function MarkdownMessage({ children, onImageClick }) {
  const [selectedImage, setSelectedImage] = useState(null);
  const lines = String(children || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${blocks.length}`}><code className={language ? `language-${language}` : undefined}>{code.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const Heading = `h${heading[1].length}`;
      blocks.push(<Heading key={`heading-${blocks.length}`}>{renderInline(heading[2], `heading-${blocks.length}`)}</Heading>);
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${blocks.length}`} />);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{quote.map((item, itemIndex) => <Fragment key={itemIndex}>{renderInline(item, `quote-${blocks.length}-${itemIndex}`)}{itemIndex < quote.length - 1 && <br />}</Fragment>)}</blockquote>);
      continue;
    }

    const list = line.match(listPattern);
    if (list) {
      const result = readList(lines, index, indentSize(list[1]));
      blocks.push(<Fragment key={`list-${blocks.length}`}>{result.node}</Fragment>);
      index = result.index;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^```/.test(lines[index]) && !/^(#{1,6})\s+/.test(lines[index]) && !/^>\s?/.test(lines[index]) && !listPattern.test(lines[index]) && !/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${blocks.length}`}>{paragraph.map((item, itemIndex) => <Fragment key={itemIndex}>{renderInline(item, `paragraph-${blocks.length}-${itemIndex}`)}{itemIndex < paragraph.length - 1 && <br />}</Fragment>)}</p>);
  }

  return <ImageClick.Provider value={onImageClick || setSelectedImage}><div className="message-markdown">{blocks}</div>
    {!onImageClick && selectedImage && <ImageViewer images={[selectedImage]} selectedId={selectedImage.id} onSelect={() => {}} onClose={() => setSelectedImage(null)} />}
  </ImageClick.Provider>;
}
