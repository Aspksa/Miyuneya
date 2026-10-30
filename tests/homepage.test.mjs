import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/blank.js', import.meta.url), 'utf8');
const defaults = {
  theme:'light',accent:'#7775d7',railWidth:'regular',iconSize:'regular',
  railOpacity:100,font:'system',fontSize:'regular',radius:'regular',
  density:'comfortable',motion:true,background:'default',scale:100,contrast:false
};
test('Cloud settings script compiles exactly once without duplicated handlers',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.equal(source.split("// Cloud.ru uses the SAME").length-1,1);
  assert.equal(source.split("const validModelId =").length-1,1);
  assert.equal(source.split("void load();").length-1,1);
});

const tick = () => new Promise(r => setImmediate(r));
function mount(backend={appearance:{...defaults}},stored=new Map(),storageDisabled=false) {
  let document;
  const element=(props={})=>({
    hidden:false,checked:false,disabled:false,dataset:{},attributes:{},listeners:new Map(),
    ...props,
    setAttribute(n,v){this.attributes[n]=v;},
    addEventListener(n,cb){this.listeners.set(n,cb);},
    fire(n,e={}){this.listeners.get(n)?.({preventDefault(){},...e});},
    focus(){document.activeElement=this;}
  });
  const css=new Map(),mediaCallbacks=[];
  const page=element({dataset:{},style:{
    setProperty(k,v){css.set(k,v);},
    removeProperty(k){css.delete(k);}
  }});
  const toggle=element(),dialog=element({hidden:true}),backdrop=element({hidden:true});
  const close=element(),reset=element(),status=element({hidden:true}),meta=element();
  const defaultBackground=element({checked:true});
  const opacityOutput=element();
  const controls=[
    ...['light','dark','auto'].map(value=>element({type:'radio',value,checked:value==='light',dataset:{setting:'theme'}})),
    ...Object.entries(defaults).filter(([k])=>k!=='theme').map(([k,v])=>element({
      type:typeof v==='boolean'?'checkbox':'select-one',
      value:String(v==='default'?'#f8f9fc':v),checked:v===true,dataset:{setting:k}
    }))
  ];
  const swatches=['#7775d7','#599a94'].map(value=>element({dataset:{accent:value}}));
  const entries={
    'settings-toggle':toggle,'settings-panel':dialog,'settings-backdrop':backdrop,
    'settings-close':close,'appearance-reset':reset,'theme-status':status,
    'default-background':defaultBackground,'opacity-value':opacityOutput
  };
  const listeners=new Map();
  document={
    documentElement:page,activeElement:null,
    getElementById(id){return entries[id];},
    querySelector(q){return q==='meta[name="theme-color"]'?meta:null;},
    querySelectorAll(q){return q==='[data-setting]'?controls:q==='[data-accent]'?swatches:[];},
    addEventListener(n,cb){listeners.set(n,cb);},
    fire(n,e={}){listeners.get(n)?.({preventDefault(){},...e});}
  };
  const window={
    matchMedia(){return {matches:!!backend.dark,addEventListener(n,cb){if(n==='change')mediaCallbacks.push(cb);}};},
    localStorage:{
      getItem(k){if(storageDisabled)throw Error('disabled');return stored.get(k)??null;},
      setItem(k,v){if(storageDisabled)throw Error('disabled');stored.set(k,v);}
    }
  };
  const fetch=async(path,opts={})=>{
    assert.equal(path,'/api/site/appearance');
    if(opts.method==='PUT'){
      if(backend.fail)return {ok:false};
      backend.appearance=JSON.parse(opts.body).appearance;
      return {ok:true};
    }
    return {ok:true,json:async()=>({appearance:{...backend.appearance}})};
  };
  runInNewContext(source,{document,window,fetch});
  const field=(name,value)=>controls.find(c=>c.dataset.setting===name && (value===undefined || c.value===value));
  const change=(name,value)=>{
    const c=field(name,name==='theme'?value:undefined);
    assert.ok(c,'missing control '+name);
    if(c.type==='checkbox')c.checked=value;
    else c.value=String(value);
    if(c.type==='radio')c.checked=true;
    c.fire('change');
  };
  return {document,page,toggle,dialog,backdrop,close,reset,status,meta,defaultBackground,opacityOutput,controls,swatches,css,change,field,mediaCallbacks,backend,stored};
}

test('Right settings icon, backdrop and Escape control the panel',async()=>{
  const a=mount();await tick();
  assert.equal(a.dialog.hidden,true);
  a.toggle.fire('click');
  assert.equal(a.dialog.hidden,false);
  assert.equal(a.toggle.attributes['aria-expanded'],'true');
  assert.equal(a.document.activeElement,a.close);
  a.document.fire('keydown',{key:'Escape'});
  assert.equal(a.dialog.hidden,true);
  a.toggle.fire('click');a.backdrop.fire('click');
  assert.equal(a.dialog.hidden,true);
});

test('All appearance controls apply live and persist across different browser ports',async()=>{
  const backend={appearance:{...defaults}};
  const a=mount(backend);await tick();
  a.change('theme','dark');a.change('railWidth','wide');a.change('iconSize','large');
  a.change('railOpacity',80);a.change('font','georgia');a.change('fontSize','large');
  a.change('radius','large');a.change('density','compact');a.change('scale',110);
  a.change('motion',false);a.change('contrast',true);
  a.swatches[1].fire('click');
  a.defaultBackground.checked=false;a.defaultBackground.fire('change');
  await tick();await tick();
  assert.equal(backend.appearance.theme,'dark');
  assert.equal(backend.appearance.railWidth,'wide');
  assert.equal(backend.appearance.iconSize,'large');
  assert.equal(backend.appearance.scale,110);
  assert.equal(backend.appearance.background,'#12151b');
  assert.equal(backend.appearance.accent,'#599a94');
  assert.equal(a.css.get('--ui-scale'),'1.1');
  assert.equal(a.css.get('--rail-width'),'96px');
  assert.equal(a.page.dataset.motion,'off');
  assert.equal(a.page.dataset.contrast,'true');
  assert.equal(a.opacityOutput.textContent,'80%');
  const b=mount(backend,new Map());await tick();
  assert.equal(b.page.dataset.theme,'dark');
  assert.equal(b.field('railWidth').value,'wide');
  assert.equal(b.css.get('--accent'),'#599a94');
  assert.equal(b.status.hidden,true);
});

test('System theme follows OS, reset restores all defaults',async()=>{
  const backend={appearance:{...defaults},dark:true};
  const a=mount(backend);await tick();
  a.change('theme','auto');await tick();
  assert.equal(a.page.dataset.theme,'dark');
  backend.dark=false;
  // The event is emitted by matchMedia when the system preference changes.
  // A new page load gets the current preference even when no change occurred.
  const b=mount(backend);await tick();
  assert.equal(b.page.dataset.theme,'light');
  b.change('accent','#648bc4');await tick();
  b.reset.fire('click');await tick();await tick();
  assert.equal(backend.appearance.theme,'light');
  assert.equal(backend.appearance.accent,defaults.accent);
  assert.equal(b.page.dataset.theme,'light');
});

test('Custom background starts from the actual dark theme instead of forcing a light color',async()=>{
  const backend={appearance:{...defaults,theme:'dark'}};
  const app=mount(backend);
  await tick();
  assert.equal(app.page.dataset.theme,'dark');
  assert.equal(app.field('background').value,'#12151b');
  app.defaultBackground.checked=false;
  app.defaultBackground.fire('change');
  await tick();await tick();
  assert.equal(backend.appearance.background,'#12151b');
  app.defaultBackground.checked=true;
  app.defaultBackground.fire('change');
  await tick();await tick();
  assert.equal(backend.appearance.background,'default');
});

test('Failed server save and blocked localStorage do not prevent preview',async()=>{
  const backend={appearance:{...defaults},fail:true};
  const a=mount(backend,new Map(),true);await tick();
  a.change('theme','dark');await tick();await tick();
  assert.equal(a.page.dataset.theme,'dark');
  assert.equal(a.status.dataset.error,'true');
  assert.match(a.status.textContent,/Не удалось сохранить/);
});
