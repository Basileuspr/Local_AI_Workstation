import {AmbientLight,AxesHelper,Box3,BufferAttribute,BufferGeometry,Color,DirectionalLight,GridHelper,Group,
  MaterialLoader,Mesh,OrthographicCamera,PerspectiveCamera,Scene,Vector3,WebGLRenderer} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

export function createModelScene(host,payload,onError) {
  const scene=new Scene(),geometries=new Map(),materials=new Map();
  const renderer=new WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
  let failedControls=null;
  try {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.5));
  renderer.domElement.setAttribute('aria-label','Interactive 3D model');renderer.domElement.tabIndex=0;
  renderer.domElement.setAttribute('data-model-viewer-canvas','');renderer.domElement.className='model-canvas';
  host.appendChild(renderer.domElement);
  const materialLoader=new MaterialLoader();
  for(const [id,data] of Object.entries(payload.materials)){const m=materialLoader.parse(data);m.side=2;materials.set(id,m);}
  for(const [id,data] of Object.entries(payload.geometries)) {
    const g=new BufferGeometry();for(const [key,a] of Object.entries(data.attributes))g.setAttribute(key,new BufferAttribute(a.array,a.itemSize,a.normalized));
    if(data.index)g.setIndex(new BufferAttribute(data.index,1));for(const group of data.groups)g.addGroup(group.start,group.count,group.materialIndex);
    geometries.set(id,g);
  }
  function unpack(node) {
    const object=node.geometry?new Mesh(geometries.get(node.geometry),node.material.length===1?materials.get(node.material[0]):node.material.map(id=>materials.get(id))):new Group();
    object.name=node.name;object.matrix.fromArray(node.matrix);object.matrix.decompose(object.position,object.quaternion,object.scale);
    for(const child of node.children)object.add(unpack(child));return object;
  }
  const model=unpack(payload.tree),root=new Group();root.add(model);scene.add(root);
  const box=new Box3().setFromObject(model),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3());root.position.copy(center).negate();
  const radius=Math.max(size.length()/2,.001);
  const grid=new GridHelper(radius*3,20,0x657d90,0x354451);grid.rotation.x=Math.PI/2;grid.position.z=-size.z/2;scene.add(grid);
  const axes=new AxesHelper(radius*.7);axes.position.set(-radius,-radius,-size.z/2);scene.add(axes);
  scene.add(new AmbientLight(0xffffff,1.7));const light=new DirectionalLight(0xffffff,2.5);light.position.set(radius*2,-radius*3,radius*4);scene.add(light);
  const perspective=new PerspectiveCamera(40,1,radius/1000,radius*1000),orthographic=new OrthographicCamera(-1,1,1,-1,radius/1000,radius*1000);
  let camera=perspective,controls=null,frame=0,disposed=false,width=1,height=1,frames=0;
  function render() {frame=0;if(disposed||document.hidden)return;renderer.render(scene,camera);host.dataset.renderCount=String(++frames);}
  function invalidate(){if(!disposed&&!frame&&!document.hidden)frame=requestAnimationFrame(render);}
  function bindControls(){controls?.dispose();controls=new OrbitControls(camera,renderer.domElement);failedControls=controls;controls.enableDamping=false;controls.minDistance=radius/100;controls.maxDistance=radius*100;controls.addEventListener('change',invalidate);}
  function fit(direction=new Vector3(1,-1,.8)) {
    direction.normalize();const angle=Math.min(perspective.fov*Math.PI/360,Math.atan(Math.tan(perspective.fov*Math.PI/360)*(width/height)));
    camera.position.copy(direction.multiplyScalar(radius/Math.sin(angle)*1.15));camera.up.set(0,0,1);
    // Avoid a singular look-at basis for the exact top and bottom views.
    if(Math.abs(direction.z)/direction.length()>.999)camera.up.set(0,1,0);
    camera.zoom=1;camera.lookAt(0,0,0);camera.updateProjectionMatrix();controls.target.set(0,0,0);controls.update();invalidate();
  }
  function resize(){width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);renderer.setSize(width,height);perspective.aspect=width/height;perspective.updateProjectionMatrix();
    const half=radius*1.2;orthographic.left=-half*Math.max(1,width/height);orthographic.right=-orthographic.left;
    orthographic.top=half*Math.max(1,height/width);orthographic.bottom=-orthographic.top;orthographic.updateProjectionMatrix();invalidate();}
  function theme(){scene.background=new Color(getComputedStyle(host).getPropertyValue('--bg-card').trim()||'#141c28');invalidate();}
  function visibility(){if(document.hidden){cancelAnimationFrame(frame);frame=0;}else invalidate();}
  function lost(event){event.preventDefault();onError('Graphics context was lost. Close the model and open it again.');}
  function capture(){if(!disposed)renderer.render(scene,camera);}
  camera.up.set(0,0,1);bindControls();resize();fit();theme();
  const observer=new ResizeObserver(resize);observer.observe(host);
  const themes=new MutationObserver(theme);themes.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});themes.observe(document.body,{attributes:true,attributeFilter:['class','style','data-theme']});
  document.addEventListener('visibilitychange',visibility);renderer.domElement.addEventListener('webglcontextlost',lost);
  renderer.domElement.addEventListener('workstation-capture',capture);
  const views={Front:[0,-1,0],Back:[0,1,0],Left:[-1,0,0],Right:[1,0,0],Top:[0,0,1],Bottom:[0,0,-1],Isometric:[1,-1,.8]};
  return {
    view(name){fit(new Vector3(...(views[name]||views.Isometric)));},fit(){fit(camera.position.clone().sub(controls.target));},
    projection(ortho){const direction=camera.position.clone().sub(controls.target);camera=ortho?orthographic:perspective;bindControls();resize();fit(direction);},
    wireframe(value){for(const m of materials.values())m.wireframe=value;invalidate();},grid(value){grid.visible=value;invalidate();},axes(value){axes.visible=value;invalidate();},
    dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer.disconnect();themes.disconnect();document.removeEventListener('visibilitychange',visibility);renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.removeEventListener('workstation-capture',capture);controls.dispose();
      for(const g of geometries.values())g.dispose();for(const m of materials.values()){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();}
      grid.geometry.dispose();for(const m of Array.isArray(grid.material)?grid.material:[grid.material])m.dispose();axes.geometry.dispose();axes.material.dispose();
      scene.clear();renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();geometries.clear();materials.clear();},
  };
  } catch(error) {
    failedControls?.dispose();
    scene.traverse(node=>{node.geometry?.dispose();for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[])material.dispose();});
    for(const geometry of geometries.values())geometry.dispose();for(const material of materials.values())material.dispose();
    renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();throw error;
  }
}
