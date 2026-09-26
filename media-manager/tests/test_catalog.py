from pathlib import Path
import tempfile
import unittest
from media_organizer import catalog, custom_folders, manifest, media_actions, mover, scan
from media_organizer.ui_server import UIState
from tests.mp4build import build


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='organizer_catalog_');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.state=UIState(str(self.root/'runs'));self.sources=[];self.runs=[]
        for i in range(5):
            source=self.root/f'folder-{i}';source.mkdir();self.sources.append(source)
            for year in range(2016,2021):
                (source/f'VID_{year}0615_120000.mp4').write_bytes(build(None,1280,720,mdat_size=100+year))
            self.runs.append(self.scan(source))

    def scan(self,source):
        run,_=scan.run_scan(scan.ScanOptions(str(source),str(self.root/'archive'),str(self.state.reports),
            ffprobe='missing-test-tool',allow_missing_tools=True,use_exiftool=False,quiet=True),out=lambda *_:None)
        return Path(run).name

    def test_years_span_five_folders_and_rescans_dont_duplicate_locations(self):
        self.scan(self.sources[0])
        before={path:path.read_bytes() for path in self.state.reports.glob('*/manifest.json')}
        data=self.state.library(catalog.ALL_SCANS)
        self.assertEqual((data['folderCount'],data['scanCount'],len(data['records'])),(5,6,25))
        for year in range(2016,2021): self.assertEqual(sum(str(r['ResolvedYear'])==str(year) for r in data['records']),5)
        self.assertEqual(sum(r['DuplicatePrimary']=='yes' for r in data['records']),5)
        repeated=[r for r in data['records'] if len(r['SeenInScans'])==2];self.assertEqual(len(repeated),5)
        for row in data['records']:self.assertEqual(self.state.media_path(catalog.ALL_SCANS,row['RecordId']),Path(row['CurrentPath']))
        for path,content in before.items():self.assertEqual(path.read_bytes(),content)
        with self.assertRaises(ValueError):self.state.media_path(catalog.ALL_SCANS,'../outside~1')
        with self.assertRaises(ValueError):self.state.media_path(catalog.ALL_SCANS,'all-scans~1')

    def test_rotation_rename_trash_restore_and_tags_route_to_the_right_scan_copy(self):
        self.scan(self.sources[0])
        row=next(r for r in self.state.library(catalog.ALL_SCANS)['records'] if r['ResolvedYear']=='2019')
        original=Path(row['CurrentPath']).read_bytes()
        self.state.rotate(catalog.ALL_SCANS,row['RecordId'],1)
        records=self.state.library(catalog.ALL_SCANS)['records']
        self.assertEqual(sum(r['ViewRotation']==90 for r in records),1)
        native=next(r for r in self.state.library(row['OriginRunId'])['records'] if r['RecordId']==row['OriginRecordId'])
        self.assertEqual(native['ViewRotation'],90)
        tag=media_actions.tag_action(self.state,dict(action='create',name='Catalog tag'))['tag']
        media_actions.tag_action(self.state,dict(action='assign',runId=catalog.ALL_SCANS,recordIds=[row['RecordId']],tagId=tag['id']))
        def act(action,**extra):
            current=next(r for r in self.state.library(catalog.ALL_SCANS)['records'] if r['RecordId']==row['RecordId'])
            media_actions.execute(self.state,dict(runId=catalog.ALL_SCANS,recordId=current['RecordId'],expectedPath=current['CurrentPath'],action=action,**extra),lambda **_:None)
        act('rename',name='Catalog rename');act('delete',confirmation='DELETE')
        trashed=next(r for r in self.state.library(catalog.ALL_SCANS)['records'] if r['RecordId']==row['RecordId'])
        self.assertTrue(trashed['Trashed']);self.assertEqual(len(self.state.library(catalog.ALL_SCANS)['records']),25)
        act('restore')
        current=next(r for r in self.state.library(catalog.ALL_SCANS)['records'] if r['RecordId']==row['RecordId'])
        self.assertEqual(current['OriginalFilename'],'Catalog rename.mp4');self.assertEqual(current['Tags'],['Catalog tag'])
        self.assertEqual(Path(current['CurrentPath']).read_bytes(),original)

    def test_cross_scan_selected_move_remains_visible_and_undoable(self):
        self.scan(self.sources[0])
        data=self.state.library(catalog.ALL_SCANS);selected=[r for r in data['records'] if str(r['ResolvedYear'])=='2019']
        self.assertEqual(len(selected),5)
        folder=custom_folders.add_folder(self.state.reports,str(self.root/'Chosen 2019'),'2019 collection')
        preview=custom_folders.prepare(self.state,catalog.ALL_SCANS,folder['id'],[r['RecordId'] for r in selected])
        self.assertEqual(len(preview['files']),5)
        plan=custom_folders.consume_plan(self.state,catalog.ALL_SCANS,preview['planId'])
        result=custom_folders.execute(self.state,plan,lambda **_:None);self.assertEqual(result['status'],'complete')
        data=self.state.library(catalog.ALL_SCANS);self.assertEqual(len(data['records']),25)
        self.assertEqual(sum(r['CustomFolderId']==folder['id'] for r in data['records']),5)
        self.assertTrue(all(r['Available'] for r in data['records']))
        for row in selected:
            native=next(r for r in self.state.library(row['OriginRunId'])['records'] if r['RecordId']==row['OriginRecordId'])
            self.assertEqual(native['CustomFolderId'],folder['id'])
        moves=next((self.state.reports/catalog.ALL_SCANS/'moves').iterdir())
        mover.run_undo(str(moves),execute=True,yes=True,quiet=True,out=lambda *_:None)
        data=self.state.library(catalog.ALL_SCANS);self.assertEqual(len(data['records']),25)
        self.assertFalse(any(r['CustomFolderId'] for r in data['records']))

    def test_unreadable_scans_are_reported_and_unknown_dates_stay_in_library(self):
        broken=self.state.reports/'broken';broken.mkdir();(broken/'manifest.json').write_text('{')
        file=self.state.run_path(self.runs[0])/'manifest.json';data=manifest.load_manifest(str(file))
        data['records'][0].update(ResolvedDate='',ResolvedYear='Unknown');manifest.write_json(str(file),data)
        result=self.state.library(catalog.ALL_SCANS)
        self.assertEqual(len(result['records']),25);self.assertEqual(result['readErrors'][0]['scan'],'broken')
        self.assertTrue(any(r['ResolvedYear']=='Unknown' for r in result['records']))
