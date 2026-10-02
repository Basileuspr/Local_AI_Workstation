import React from 'react';
import { createRoot } from 'react-dom/client';
import ApplicationMaintenance from '../../src/components/ApplicationMaintenance';
import '../../src/styles.css';
import '../../src/components/Dashboard.css';
const response = value => new Response(JSON.stringify(value), { headers:{'Content-Type':'application/json'} });
window.fetch = async url => {
  const path = new URL(url, location.href).pathname;
  if (path.endsWith('/updates')) return response({current_version:'1.0.1-dev',latest_version:null,status:'unable_to_check',detail:'Fixture offline release check. No environment was changed.'});
  if (path.endsWith('/environment')) return response({static:{sampled_at:new Date().toISOString(),os:{os_name:'Fixture OS'},gpus:[],python:{version:'3.13'},pytorch:{version:null,cuda_available:null},warnings:['Fixture missing GPU information']},services:{ollama:{available:false}}});
  return response({profiles:['requirements.txt'],python:{installed:'3.13',recorded_baseline:'3.13'},node:{recorded_baseline:'22'},limitations:'Isolated test data. All installation actions are simulated.',installed_metadata_conflicts:[],
    dependencies:[{ecosystem:'python',profile:'requirements.txt',name:'psutil',installed:'7.2.1',declared:'psutil>=7.2,<8',status:'compatible',recorded_target:'7.2.2',upgrade_risk:'scoped_recorded_target',updatable:true},
      {ecosystem:'python',profile:'requirements.txt',name:'torch',installed:null,declared:'torch==2.11.0+cu128',status:'missing',recorded_target:'2.11.0+cu128',upgrade_risk:'manual_review',updatable:false}]});
};
window.workstationDesktop = {
  prepareDependencyUpdate:async name=>({status:'approval_required',name,current:'7.2.1',target:'7.2.2',ticket:'fixture-only',scope:'Simulated package update; no filesystem changes.',risk:'Fixture data',expires_at:Date.now()/1000+600}),
  approveDependencyUpdate:async()=>({status:'success',name:'psutil',detail:'Simulated installation. Your packages were not modified.'}),
  cancelDependencyUpdate:async()=>({status:'cancelled'}),
};
createRoot(document.getElementById('root')).render(<main className="dashboard"><ApplicationMaintenance/></main>);
