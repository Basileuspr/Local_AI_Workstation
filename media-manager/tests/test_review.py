import base64
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from media_organizer import review,scan,media_actions
from media_organizer.ui_server import UIState
from tests.mp4build import build


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='law-media-review-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);source=self.root/'source';source.mkdir()
        self.original=build(None,1280,720,mdat_size=100);self.file=source/'VID_20200615_120000.mp4';self.file.write_bytes(self.original)
        run,_=scan.run_scan(scan.ScanOptions(str(source),str(self.root/'archive'),str(self.root/'runs'),ffprobe='missing-test-tool',allow_missing_tools=True,use_exiftool=False,quiet=True),out=lambda *_:None)
        self.state=UIState(str(self.root/'runs'));self.run=Path(run).name;self.row=self.state.library(self.run)['records'][0]
        self.state.thumbnails.get=lambda *args,**kwargs:b'fixture preview bytes'

    def test_samples_only_scanned_files_and_rejects_changed_source(self):
        value=review.sample(self.state,self.run,self.row['RecordId'])
        self.assertEqual(value['digest'],hashlib.sha256(self.original).hexdigest())
        self.assertEqual(base64.b64decode(value['image']),b'fixture preview bytes')
        self.assertEqual(self.file.read_bytes(),self.original)
        with self.assertRaises(ValueError):review.sample(self.state,self.run,'../outside')
        self.file.write_bytes(self.original+b'changed')
        with self.assertRaisesRegex(ValueError,'changed'):review.sample(self.state,self.run,self.row['RecordId'])

    def test_classification_is_bounded_and_does_not_pass_paths_to_host(self):
        with patch.object(review,'request',return_value={'id':'job'}) as bridge:
            review.action(self.state,{'operation':'classify','runId':self.run,'recordIds':[self.row['RecordId']],'faces':True})
            operation,payload=bridge.call_args.args
            self.assertEqual(operation,'classify');self.assertNotIn(str(self.file),json.dumps(payload))
            with self.assertRaises(ValueError):review.action(self.state,{'operation':'classify','runId':self.run,'recordIds':['x']*21})

    def test_notes_and_tags_use_existing_metadata_and_export_copies(self):
        value={'review':{'rating':'liked','caption':'Caption','tags':['Trip']},'classification':{'faces':[],'scenes':[]}}
        with patch.object(review,'request',return_value=value):
            review.action(self.state,{'operation':'save','runId':self.run,'recordId':self.row['RecordId'],'review':value['review']})
            self.assertEqual(media_actions.metadata(self.state.reports)['tags'][0]['name'],'Trip')
            self.assertEqual(len(self.state.library(self.run)['records'][0]['TagIds']),1)
            result=review.action(self.state,{'operation':'export','runId':self.run,'recordIds':[self.row['RecordId']]})
        with zipfile.ZipFile(result['path']) as archive:
            self.assertEqual(archive.read('001-preview.jpg'),b'fixture preview bytes')
            self.assertEqual(archive.read('001-preview.jpg.txt'),b'Caption')
        self.assertEqual(self.file.read_bytes(),self.original)

    def test_bridge_rejects_nonlocal_and_arbitrary_operations(self):
        with patch.dict('os.environ',{'LAW_MEDIA_REVIEW_BASE':'https://example.com','LAW_MEDIA_REVIEW_TOKEN':'review-only'}):
            with self.assertRaises(ValueError):review.request('catalog')
        with self.assertRaises(ValueError):review.request('../sessions')
        with self.assertRaises(ValueError):review.NoRedirect().redirect_request(None,None,None,None,None,None)

    def test_open_adopts_shared_tag_edits_and_clears_in_native_palette(self):
        for tags in (['Shared review'],[]):
            with patch.object(review,'request',return_value={'review':{'tags':tags}}) as bridge:
                value=review.action(self.state,{'operation':'open','runId':self.run,'recordId':self.row['RecordId']})
            self.assertEqual(value['review']['tags'],tags)
            assigned=set(media_actions.metadata(self.state.reports)['assignments'].get(self.row['SHA256'].upper(),[]))
            palette=media_actions.metadata(self.state.reports)['tags']
            self.assertEqual([tag['name'] for tag in palette if tag['id'] in assigned],tags)
            self.assertIn('native_tags',bridge.call_args.args[1])
            self.assertEqual(self.file.read_bytes(),self.original)

    def test_person_name_choices_include_tags_on_unclassified_videos(self):
        media_actions.tag_action(self.state,{'action':'create','name':'Last, First'})
        media_actions.tag_action(self.state,{'action':'create','name':'Trip'})
        metadata_path=self.state.reports/'ui-metadata.json';before=metadata_path.read_bytes()
        with patch.object(review,'request',return_value={'items':[],'people':[],'available_tags':['trip','Ada']}) as bridge:
            result=review.action(self.state,{'operation':'catalog'})
        self.assertEqual(result['available_tags'],['Ada','Last, First','Trip'])
        self.assertEqual(bridge.call_args.args,('catalog',))
        self.assertEqual(metadata_path.read_bytes(),before)

    def test_foundation_fields_cross_the_bridge_without_clearing_existing_tags(self):
        value={'review':{'rating':'liked','caption':'Caption','tags':['Trip']},'classification':{'faces':[],'scenes':[]}}
        with patch.object(review,'request',return_value=value):
            review.action(self.state,{'operation':'save','runId':self.run,'recordId':self.row['RecordId'],'review':value['review']})
        metadata_path=self.state.reports/'ui-metadata.json';before=metadata_path.read_bytes()
        changes={'category':'Reference','project':'Album','favorite':False,'review_status':'accepted'}
        with patch.object(review,'request',return_value=changes) as bridge:
            result=review.action(self.state,{'operation':'save','runId':self.run,'recordId':self.row['RecordId'],'review':changes})
        operation,payload=bridge.call_args.args
        self.assertEqual(operation,'review')
        self.assertEqual(result,changes)
        self.assertEqual({key:payload[key] for key in changes},changes)
        self.assertNotIn('tags',payload);self.assertNotIn('rating',payload);self.assertNotIn('caption',payload)
        self.assertNotIn(str(self.file),json.dumps(payload))
        self.assertEqual(metadata_path.read_bytes(),before)


if __name__=='__main__':unittest.main()
