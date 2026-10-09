"""Explicit normalized-document handoff to the existing Knowledge pipeline."""
from datetime import datetime, timezone
import hashlib
import json
from urllib.parse import urlsplit


def normalized(document):
    if document.status!=200 or document.truncated or not document.text.strip():raise ValueError('Only complete captured text can be saved to Knowledge.')
    return {'url':document.url,'title':document.title,'retrieved_at':datetime.fromtimestamp(document.retrieved_at,timezone.utc).isoformat(),
        'source_id':document.source_id or 'one-time-research','content_hash':document.content_hash,'content_type':document.kind,'published_at':document.published_at,
        'text':document.text,'untrusted':True}


def ingest(document,*,cancel_event=None):
    from services import knowledge_base as kb
    runtime=urlsplit(kb.OLLAMA_BASE_URL)
    if runtime.scheme!='http' or runtime.hostname not in {'127.0.0.1','localhost','::1'} or runtime.username or runtime.password:
        raise ValueError('Web Knowledge handoff requires local loopback embeddings.')
    item=normalized(document)
    filename='Web-'+hashlib.sha256((item['url']+'|'+item['content_hash']).encode()).hexdigest()+'.md'
    doc_id=hashlib.md5(filename.encode()).hexdigest()[:12]
    existing=kb._get_collection().get(where={'doc_id':doc_id},include=[])
    if existing['ids']:return {'doc_id':doc_id,'filename':filename,'duplicate':True}
    metadata={k:v for k,v in item.items() if k!='text'}
    text='# '+item['title']+'\n\nWeb provenance: '+json.dumps(metadata,ensure_ascii=False)+'\n\nUntrusted source material:\n\n'+item['text']
    result=kb.add_document(text,filename,cancel_event=cancel_event)
    if result.get('error'):raise ValueError('Knowledge could not index the selected web document.')
    return result
