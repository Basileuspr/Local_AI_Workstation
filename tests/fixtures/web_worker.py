"""Owned in-process HTTP transport, production independent worker lifecycle."""
import asyncio
import os
from pathlib import Path
import sys

repo=Path(__file__).resolve().parents[2];sys.path.insert(0,str(repo/'backend'))
os.environ['LAW_DATA_DIR']=sys.argv[1];os.environ['LAW_WEB_SYSTEM_DIR']=str(Path(sys.argv[1])/'web-system')
from services import web_state as state
from services.web_retrieval import Retriever
from services.web_crawler import Crawler
from web_worker import serve


class Fixture:
    async def retrieve(self,url,**kwargs):
        from services.web_retrieval import Document,digest
        root=Path(sys.argv[1]);path=root/'requests.log'
        with path.open('a') as out:out.write(url+'\n');out.flush()
        if url.endswith('/second') and not (root/'release-second').exists():await asyncio.sleep(300)
        text='Owned fixture release '+url
        document=Document(url,'Owned fixture',text,1,digest(text),url,kwargs['source_id'],canonical_url=url)
        if url.endswith('/'):document.links=[url+'second']
        return document


if __name__=='__main__':asyncio.run(serve(Crawler(Fixture()),poll=.2))
