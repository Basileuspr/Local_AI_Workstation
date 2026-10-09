"""Real local Ollama query planning, cited answer and fact check over owned pages."""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import httpx

repo=Path(__file__).resolve().parents[1];root=Path(tempfile.mkdtemp(prefix='law-web-local-qa-'))
sys.path[:0]=[str(repo/'backend'),str(repo/'tests'/'backend')]
os.environ['LAW_WEB_SYSTEM_DIR']=str(root/'web-system')
os.environ['LAW_DATA_DIR']=str(root)
from services.web_research import Research,search_config
from services.web_retrieval import Retriever
from services.web_access import WebAccess
from test_web_access import Clock,public_dns


async def main():
    clock=Clock();requests=[]
    def response(req):
        requests.append(req.url.path)
        if req.url.path=='/robots.txt':return httpx.Response(404)
        if req.url.path=='/search':return httpx.Response(200,json={'results':[{'url':'https://site.example.com/release','title':'Owned Tool release','content':'Owned Tool 3.2 offline inference release'}]})
        content='Owned Tool version 3.2 supports offline inference. The publisher released version 3.2 on 2026-10-07. Its documented use is searching local files without sending them to a remote service.'
        if req.url.path=='/guide':content='The Owned Tool guide describes offline inference and searching local files. The guide confirms the capability described by the publisher.'
        return httpx.Response(200,text='<html><head><title>Owned Tool</title><meta property="article:published_time" content="2026-10-07"></head><body><main>'+content+'</main></body></html>',headers={'content-type':'text/html'})
    retriever=Retriever(WebAccess(root/'transport',httpx.MockTransport(response),public_dns,clock.now,clock.sleep))
    search_config({'provider':'searxng','endpoint':'https://search.example.com/search'})
    manager=Research(retriever)
    job=manager.start('What version and capabilities do these Owned Tool pages describe? Distinguish publisher claims from verified outside facts.',
        sys.argv[1] if len(sys.argv)>1 else 'mistral:latest',urls=['https://site.example.com/release','https://site.example.com/guide'],follow_links=False,max_pages=2)
    try:
        await manager.tasks[job['id']];result=manager.state(job['id'])
        (root/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        assert result['status'] in {'COMPLETED','PARTIAL'},json.dumps(result)
        assert len(result['sources'])==2 and result['answer'] and all(p['citations'] for p in result['answer'])
        print(json.dumps({'ok':True,'model':result['model'],'answer':result['answer'],'sources':result['sources'],'requests':len(requests),'artifacts':str(root)},indent=2))
        from routes.files import _embedding_work
        from services import web_knowledge,knowledge_base as kb
        class Request:
            async def is_disconnected(self):return False
        saved=await _embedding_work(Request(),'Fixture explicit web Knowledge handoff',web_knowledge.ingest,manager.document(job['id'],'S1'))
        assert saved['chunks']>0 and len(kb.list_documents())==1
        duplicate=await _embedding_work(Request(),'Fixture duplicate web handoff',web_knowledge.ingest,manager.document(job['id'],'S1'))
        assert duplicate['duplicate'] and len(kb.list_documents())==1
        await manager.discard(job['id']);assert not manager.documents and not manager.jobs
        assert not (root/'web-system'/'content').exists()
        assert len(kb.list_documents())==1
        print(json.dumps({'knowledge':True,'duplicate_prevented':True,'discard_preserved_knowledge':True,'doc_id':saved['doc_id']}))
    finally:await manager.close()


if __name__=='__main__':asyncio.run(main())
