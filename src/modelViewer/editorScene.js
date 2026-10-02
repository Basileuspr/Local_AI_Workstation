import {AmbientLight,AxesHelper,Box3,Box3Helper,Color,DirectionalLight,GridHelper,Line,LineBasicMaterial,BufferGeometry,Mesh,MeshBasicMaterial,MeshStandardMaterial,OrthographicCamera,PCFSoftShadowMap,PerspectiveCamera,PlaneGeometry,PMREMGenerator,Raycaster,Scene,ShadowMaterial,SRGBColorSpace,TextureLoader,Vector2,Vector3,WebGLRenderer} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {unpackGeometry} from './editor';

export function createEditorScene(host,documentModel,onError,callbacks={}){
  const scene=new Scene(),meshes=new Map(),outlines=new Map(),renderer=new WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  let controls,transform,observer,themes,grid,axes,floor,environment,frame=0,disposed=false,frames=0,width=1,height=1,radius=30,selected=[],mode='select',measurement=[],measureLine=null,pointerStart=null;
  const options={wireframe:false,grid:true,axes:true,shading:true,shadows:false,colors:true,reflections:false,smoothing:true,xray:false};
  const cameraP=new PerspectiveCamera(40,1,.01,100000),cameraO=new OrthographicCamera(-30,30,30,-30,.01,100000);let camera=cameraP;
  const ambient=new AmbientLight(0xffffff,1.8),light=new DirectionalLight(0xffffff,2.6);scene.add(ambient,light,light.target);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0005;
  const raycaster=new Raycaster(),pointer=new Vector2(),loader=new TextureLoader();
  function invalidate(){if(!disposed&&!frame&&!document.hidden)frame=requestAnimationFrame(render);}
  function render(){frame=0;if(disposed||document.hidden)return;renderer.render(scene,camera);host.dataset.renderCount=String(++frames);}
  function disposeMaterial(material){material.userData.closed=true;material.map?.dispose();material.dispose();}
  function disposeMesh(mesh){mesh.geometry.dispose();for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])disposeMaterial(m);mesh.removeFromParent();}
  function makeMaterials(object){return object.materials.map(data=>{
    const parameters={color:options.colors?data.color:'#c5ccd3',side:2,wireframe:options.wireframe,vertexColors:options.colors&&!!data.vertexColors,transparent:options.xray||data.opacity<1,opacity:options.xray?.25:data.opacity,depthWrite:!options.xray};
    const material=options.shading?new MeshStandardMaterial({...parameters,roughness:data.roughness,metalness:data.metalness,flatShading:!options.smoothing}):new MeshBasicMaterial(parameters);
    if(data.mapData&&options.colors){
      const texture=loader.load(data.mapData,()=>{if(material.userData.closed){texture.dispose();return;}invalidate();},undefined,()=>onError('A texture could not be displayed.'));texture.colorSpace=SRGBColorSpace;material.map=texture;
      // Transparent stamps reveal the paint underneath, not holes through the object.
      material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
        vec4 stampColor = texture2D( map, vMapUv );
        diffuseColor.rgb = mix( diffuseColor.rgb, stampColor.rgb, stampColor.a );
      #endif`);};
      material.customProgramCacheKey=()=> 'law-texture-overlay-v1';
    }
    return material;
  });}
  function updateMaterial(mesh,object){for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])disposeMaterial(m);const list=makeMaterials(object);mesh.material=list.length===1?list[0]:list;}
  function allBounds(){const b=new Box3();for(const m of meshes.values()){m.updateMatrixWorld(true);b.expandByObject(m);}return b;}
  function rebuildHelpers(){
    const box=allBounds(),size=box.isEmpty()?new Vector3(40,40,40):box.getSize(new Vector3()),center=box.isEmpty()?new Vector3():box.getCenter(new Vector3());radius=Math.max(size.length()/2,.001);
    for(const helper of [grid,axes])if(helper){helper.removeFromParent();helper.geometry.dispose();for(const m of Array.isArray(helper.material)?helper.material:[helper.material])m.dispose();}
    grid=new GridHelper(radius*4,20,0x7894a8,0x394a59);grid.rotation.x=Math.PI/2;grid.position.set(center.x,center.y,Math.min(0,box.min.z));grid.visible=options.grid;scene.add(grid);
    axes=new AxesHelper(radius*.6);axes.position.set(center.x-radius,center.y-radius,grid.position.z);axes.visible=options.axes;scene.add(axes);
    floor.scale.set(radius*4,radius*4,1);floor.position.copy(grid.position);floor.position.z-=radius*.0001;floor.visible=options.shadows;
    light.position.set(center.x+radius*2,center.y-radius*3,center.z+radius*4);light.target.position.copy(center);
    Object.assign(light.shadow.camera,{left:-radius*2,right:radius*2,top:radius*2,bottom:-radius*2,near:.01,far:radius*15});light.shadow.camera.updateProjectionMatrix();
    for(const c of [cameraP,cameraO]){c.near=Math.max(radius/10000,.0001);c.far=Math.max(radius*1000,1000);c.updateProjectionMatrix();}
    controls.minDistance=radius/100;controls.maxDistance=radius*100;resize();
  }
  function selection(ids){
    selected=ids.filter(id=>meshes.has(id));
    for(const helper of outlines.values()){helper.removeFromParent();helper.geometry.dispose();helper.material.dispose();}outlines.clear();
    for(const id of selected){const helper=new Box3Helper(new Box3().setFromObject(meshes.get(id)),0x65cef2);helper.material.depthTest=false;helper.renderOrder=10;scene.add(helper);outlines.set(id,helper);}
    transform.detach();if(selected.length===1&&['translate','rotate','scale'].includes(mode)){transform.setMode(mode);transform.attach(meshes.get(selected[0]));}
    invalidate();
  }
  function bindControls(){controls?.dispose();controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.addEventListener('change',invalidate);if(transform)transform.camera=camera;}
  function fit(direction=new Vector3(1,-1,.8)){
    const box=allBounds(),center=box.isEmpty()?new Vector3():box.getCenter(new Vector3());if(direction.length()<.01)direction.set(1,-1,.8);direction.normalize();
    const angle=Math.min(cameraP.fov*Math.PI/360,Math.atan(Math.tan(cameraP.fov*Math.PI/360)*width/height));
    camera.position.copy(center).addScaledVector(direction,radius/Math.sin(angle)*1.2);camera.up.set(0,0,1);if(Math.abs(direction.z)>.999)camera.up.set(0,1,0);
    camera.zoom=1;camera.lookAt(center);camera.updateProjectionMatrix();controls.target.copy(center);controls.update();invalidate();
  }
  function resize(){width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);renderer.setSize(width,height);cameraP.aspect=width/height;cameraP.updateProjectionMatrix();
    const half=radius*1.25;cameraO.left=-half*Math.max(1,width/height);cameraO.right=-cameraO.left;cameraO.top=half*Math.max(1,height/width);cameraO.bottom=-cameraO.top;cameraO.updateProjectionMatrix();invalidate();}
  function theme(){scene.background=new Color(getComputedStyle(host).getPropertyValue('--bg-card').trim()||'#141c28');invalidate();}
  function visibility(){if(document.hidden){cancelAnimationFrame(frame);frame=0;}else invalidate();}
  function lost(event){event.preventDefault();onError('Graphics context was lost. Save your project, then close and reopen it.');}
  function capture(){if(!disposed)renderer.render(scene,camera);}
  function clearMeasure(){measurement=[];if(measureLine){disposeMesh(measureLine);measureLine=null;}callbacks.onMeasure?.(null);invalidate();}
  function down(event){pointerStart={x:event.clientX,y:event.clientY,button:event.button,gizmo:!!transform.axis};}
  function up(event){
    if(mode==='disabled')return;
    if(!pointerStart||pointerStart.button!==0||Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>4||pointerStart.gizmo||transform.dragging)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects([...meshes.values()],false)[0];
    if(mode==='measure'){
      if(!hit)return;if(measurement.length===2)clearMeasure();measurement.push(hit.point.clone());
      if(measurement.length===2){measureLine=new Line(new BufferGeometry().setFromPoints(measurement),new LineBasicMaterial({color:0xffd47c,depthTest:false}));measureLine.renderOrder=20;scene.add(measureLine);callbacks.onMeasure?.({distance:measurement[0].distanceTo(measurement[1]),points:measurement.map(p=>p.toArray())});}
      else callbacks.onMeasure?.({pending:true});invalidate();return;
    }
    if(mode==='pick'){if(hit)callbacks.onPick?.(hit.object.userData.record.materials[hit.face?.materialIndex||0]);return;}
    const id=hit?.object.userData.record.id;let ids=[];
    if(id)ids=event.shiftKey?(selected.includes(id)?selected.filter(v=>v!==id):[...selected,id]):[id];else if(event.shiftKey)ids=selected;
    callbacks.onSelect?.(ids);
  }
  function setDocument(doc){
    const ids=new Set(doc.objects.map(o=>o.id));transform.detach();
    for(const [id,mesh] of meshes)if(!ids.has(id)){disposeMesh(mesh);meshes.delete(id);}
    for(const object of doc.objects){let mesh=meshes.get(object.id);
      if(mesh&&mesh.userData.record.geometry!==object.geometry){disposeMesh(mesh);meshes.delete(object.id);mesh=null;}
      if(!mesh){const list=makeMaterials(object);mesh=new Mesh(unpackGeometry(object.geometry),list.length===1?list[0]:list);mesh.castShadow=true;mesh.receiveShadow=true;meshes.set(object.id,mesh);scene.add(mesh);}
      else if(mesh.userData.record.materials!==object.materials)updateMaterial(mesh,object);
      mesh.name=object.name;mesh.userData.record=object;mesh.matrix.fromArray(object.matrix);mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);mesh.updateMatrixWorld(true);
    }
    clearMeasure();rebuildHelpers();selection(selected);invalidate();
  }
  function dispose(){
    if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer?.disconnect();themes?.disconnect();document.removeEventListener('visibilitychange',visibility);
    renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.removeEventListener('workstation-capture',capture);renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);
    controls?.dispose();transform?.dispose();transform?.getHelper().removeFromParent();
    for(const mesh of meshes.values())disposeMesh(mesh);meshes.clear();for(const helper of outlines.values())disposeMesh(helper);outlines.clear();
    for(const node of [grid,axes,floor,measureLine])if(node)disposeMesh(node);environment?.dispose();light.shadow.dispose();scene.clear();renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();delete host.dataset.renderCount;
  }
  try{
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.shadowMap.type=PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label','Interactive 3D model editor');renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('data-model-viewer-canvas','');renderer.domElement.className='model-canvas';host.appendChild(renderer.domElement);
    floor=new Mesh(new PlaneGeometry(1,1),new ShadowMaterial({opacity:.25}));floor.receiveShadow=true;scene.add(floor);
    camera.up.set(0,0,1);bindControls();transform=new TransformControls(camera,renderer.domElement);scene.add(transform.getHelper());transform.setSize(.85);
    transform.addEventListener('dragging-changed',event=>{controls.enabled=!event.value;});transform.addEventListener('change',()=>{for(const [id,h] of outlines)h.box.setFromObject(meshes.get(id));invalidate();});
    transform.addEventListener('mouseUp',()=>{const object=transform.object;if(object){object.updateMatrix();callbacks.onTransform?.(object.userData.record.id,object.matrix.toArray());}});
    setDocument(documentModel);fit();theme();observer=new ResizeObserver(resize);observer.observe(host);themes=new MutationObserver(theme);themes.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});themes.observe(document.body,{attributes:true,attributeFilter:['class','style','data-theme']});
    document.addEventListener('visibilitychange',visibility);renderer.domElement.addEventListener('webglcontextlost',lost);renderer.domElement.addEventListener('workstation-capture',capture);renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);
    const views={Front:[0,-1,0],Back:[0,1,0],Left:[-1,0,0],Right:[1,0,0],Top:[0,0,1],Bottom:[0,0,-1],Isometric:[1,-1,.8]};
    return {setDocument,selection,dispose,
      view(name){fit(new Vector3(...(views[name]||views.Isometric)));},fit(){fit(camera.position.clone().sub(controls.target));},
      projection(ortho){const direction=camera.position.clone().sub(controls.target);camera=ortho?cameraO:cameraP;bindControls();resize();fit(direction);},
      mode(value){mode=value;clearMeasure();selection(selected);renderer.domElement.style.cursor=['measure','pick'].includes(value)?'crosshair':'grab';},
      setting(key,value){options[key]=value;
        if(key==='grid')grid.visible=value;else if(key==='axes')axes.visible=value;
        else if(key==='shadows'){floor.visible=value;renderer.shadowMap.enabled=value;}
        else if(key==='reflections'){
          if(value&&!environment){const generator=new PMREMGenerator(renderer),room=new RoomEnvironment();environment=generator.fromScene(room,.04);room.dispose();generator.dispose();}scene.environment=value?environment.texture:null;
        }else for(const mesh of meshes.values())updateMaterial(mesh,mesh.userData.record);
        invalidate();
      },
    };
  }catch(error){dispose();throw error;}
}
