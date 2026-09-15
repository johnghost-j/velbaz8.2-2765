import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useParams, useLocation } from 'wouter';
import { api } from '../lib/api';
import { PublishModal } from '../components/PublishModal';

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface PageData { id: string; slug: string; title: string; htmlContent: string; pageType: string; lang: string; sortOrder: number; }
interface SelectedElement {
  tagPath: string; tagName: string; text: string; styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  hasChildren: boolean; innerHTML: string; attributes: Record<string, string>;
}
interface HistoryEntry { slug: string; html: string; }
type DeviceMode = 'desktop' | 'tablet' | 'mobile';
type Tool = 'move' | 'hand' | 'text' | 'frame' | 'proto';
interface ProtoLink { id: string; sourceSlug: string; sourcePath: string; targetSlug: string; sourceRect?: { x: number; y: number; w: number; h: number }; }
interface FreeFrame { id: string; x: number; y: number; width: number; height: number; label: string; color: string; }

// ─── FIGMA COLORS ────────────────────────────────────────────────────────────
const FG = {
  bg: '#1e1e1e', panel: '#2c2c2c', panelHover: '#333', surface: '#383838',
  border: '#3c3c3c', borderLight: '#4a4a4a',
  text: '#fff', textDim: '#999', textMuted: '#666',
  accent: '#E8E8E8', accentHover: '#FFFFFF', accentBg: 'rgba(255,255,255,0.12)',
  red: '#f24822', green: '#14ae5c', orange: '#ffcd29',
  selection: '#E8E8E8', selectionDim: 'rgba(232,232,232,0.3)',
};

const DEVICE_WIDTHS: Record<DeviceMode, number> = { desktop: 1440, tablet: 768, mobile: 375 };
const FRAME_HEIGHT = 900;
const FRAME_GAP = 100;
// Hard ceiling so a runaway measurement (e.g. a vh feedback loop) can never
// grow a frame infinitely on the Y axis.
const MAX_FRAME_HEIGHT = 12000;

// ─── EFFECT PRESETS ──────────────────────────────────────────────────────────
const EFFECT_PRESETS: Record<string, { label: string; value: string }[]> = {
  boxShadow: [
    { label: 'None', value: 'none' },
    { label: 'SM', value: '0 1px 2px 0 rgba(0,0,0,0.05)' },
    { label: 'Base', value: '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)' },
    { label: 'MD', value: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)' },
    { label: 'LG', value: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)' },
    { label: 'XL', value: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)' },
    { label: '2XL', value: '0 25px 50px -12px rgba(0,0,0,0.25)' },
    { label: 'Inner', value: 'inset 0 2px 4px 0 rgba(0,0,0,0.06)' },
  ],
  textShadow: [
    { label: 'None', value: 'none' },
    { label: 'SM', value: '0 1px 2px rgba(0,0,0,0.1)' },
    { label: 'Base', value: '0 2px 4px rgba(0,0,0,0.15)' },
    { label: 'LG', value: '0 4px 8px rgba(0,0,0,0.2)' },
  ],
  filter: [
    { label: 'None', value: 'none' },
    { label: 'Blur SM', value: 'blur(2px)' },
    { label: 'Blur MD', value: 'blur(4px)' },
    { label: 'Blur LG', value: 'blur(8px)' },
    { label: 'Brightness +', value: 'brightness(1.2)' },
    { label: 'Grayscale', value: 'grayscale(1)' },
    { label: 'Sepia', value: 'sepia(1)' },
    { label: 'Drop Shadow', value: 'drop-shadow(0 4px 6px rgba(0,0,0,0.15))' },
  ],
  backdropFilter: [
    { label: 'None', value: 'none' },
    { label: 'Blur SM', value: 'blur(4px)' },
    { label: 'Blur MD', value: 'blur(8px)' },
    { label: 'Blur LG', value: 'blur(16px)' },
    { label: 'Blur XL', value: 'blur(24px)' },
  ],
  transform: [
    { label: 'None', value: 'none' },
    { label: 'Scale 95%', value: 'scale(0.95)' },
    { label: 'Scale 105%', value: 'scale(1.05)' },
    { label: 'Scale 110%', value: 'scale(1.1)' },
    { label: 'Rotate 3', value: 'rotate(3deg)' },
    { label: 'Rotate -3', value: 'rotate(-3deg)' },
    { label: 'Up 4px', value: 'translateY(-4px)' },
    { label: 'Down 4px', value: 'translateY(4px)' },
  ],
  transition: [
    { label: 'None', value: 'none' },
    { label: 'All 150ms', value: 'all 150ms ease' },
    { label: 'All 300ms', value: 'all 300ms ease' },
    { label: 'All 500ms', value: 'all 500ms ease' },
    { label: 'Opacity 300ms', value: 'opacity 300ms ease' },
    { label: 'Transform 300ms', value: 'transform 300ms ease' },
    { label: 'Spring', value: 'all 500ms cubic-bezier(0.34,1.56,0.64,1)' },
  ],
};

// ─── IFRAME SCRIPT ───────────────────────────────────────────────────────────
const IFRAME_SCRIPT_FN = (slug: string) => `
(function(){
  var __SLUG__='${slug}';
  function _post(data){data.__slug__=__SLUG__;window.parent.postMessage(data,'*');}
  let selectedEls=[];let hoverEl=null;let overlayDivs=[];let hoverOverlay=null;let boundingBoxOv=null;
  let isEditing=false;let isDirty=false;let lastMoveTime=0;let clipboardEl=null;
  let dragEl=null;let dragStartX=0;let dragStartY=0;let dragOrigLeft='';let dragOrigTop='';
  let isDragging=false;
  let resizeHandle=null;let resizeStartX=0;let resizeStartY=0;
  let resizeOrigW=0;let resizeOrigH=0;let resizeOrigL=0;let resizeOrigT=0;let resizeEl=null;
  let isResizing=false;

  // ─── SMART GUIDES ─────────────────────────────────
  let guidesContainer=null;let dimLabel=null;

  function ensureGuidesContainer(){
    if(guidesContainer)return;
    guidesContainer=document.createElement('div');
    guidesContainer.id='__editor-guides';
    guidesContainer.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999990;';
    document.body.appendChild(guidesContainer);
  }

  function clearGuides(){
    if(guidesContainer)guidesContainer.innerHTML='';
    if(dimLabel)dimLabel.style.display='none';
  }

  function drawGuideLine(x1,y1,x2,y2,color){
    ensureGuidesContainer();
    var line=document.createElement('div');
    var dx=x2-x1;var dy=y2-y1;var len=Math.sqrt(dx*dx+dy*dy);
    var angle=Math.atan2(dy,dx)*180/Math.PI;
    line.style.cssText='position:fixed;background:'+color+';height:1px;transform-origin:0 0;pointer-events:none;z-index:999991;';
    line.style.width=len+'px';
    line.style.left=x1+'px';line.style.top=y1+'px';
    line.style.transform='rotate('+angle+'deg)';
    guidesContainer.appendChild(line);
    return line;
  }

  function drawDimLabel(x,y,text){
    if(!dimLabel){
      dimLabel=document.createElement('div');
      dimLabel.id='__editor-dim';
      dimLabel.style.cssText='position:fixed;background:#f24822;color:#fff;font-size:10px;font-family:Inter,system-ui,sans-serif;padding:1px 5px;border-radius:3px;pointer-events:none;z-index:999998;white-space:nowrap;font-weight:600;';
      document.body.appendChild(dimLabel);
    }
    dimLabel.textContent=text;
    dimLabel.style.left=x+'px';dimLabel.style.top=y+'px';
    dimLabel.style.display='block';
  }

  function getSiblingRects(el){
    if(!el||!el.parentElement)return[];
    var rects=[];var siblings=el.parentElement.children;
    for(var i=0;i<siblings.length;i++){
      var sib=siblings[i];
      if(sib===el||isEd(sib))continue;
      rects.push({el:sib,rect:sib.getBoundingClientRect()});
    }
    return rects;
  }

  // Snap state: track if currently snapped so we require extra force to break free
  var snappedX=false;var snappedY=false;
  var snapAccumX=0;var snapAccumY=0;
  var snappedLeft=0;var snappedTop=0;
  var SNAP_THRESHOLD=6;var SNAP_BREAK=10;

  function showSmartGuides(el,rawDx,rawDy){
    clearGuides();ensureGuidesContainer();
    var r=el.getBoundingClientRect();
    var cx=r.left+r.width/2;var cy=r.top+r.height/2;
    var siblings=getSiblingRects(el);
    var S=SNAP_THRESHOLD;var guideColor='#f24822';var distColor='rgba(13,153,255,0.6)';
    var parentR=el.parentElement?el.parentElement.getBoundingClientRect():{left:0,top:0,right:window.innerWidth,bottom:window.innerHeight,width:window.innerWidth,height:window.innerHeight};
    var snapX=null;var snapY=null;// pixel correction to apply

    // ── Check all snap targets and find closest ──
    var bestSnapX=null;var bestDistX=S+1;
    var bestSnapY=null;var bestDistY=S+1;

    function checkX(current,target,label){
      var d=target-current;if(Math.abs(d)<bestDistX){bestDistX=Math.abs(d);bestSnapX={correction:d,target:target,label:label};}
    }
    function checkY(current,target,label){
      var d=target-current;if(Math.abs(d)<bestDistY){bestDistY=Math.abs(d);bestSnapY={correction:d,target:target,label:label};}
    }

    // Parent center
    var pcx=parentR.left+parentR.width/2;
    var pcy=parentR.top+parentR.height/2;
    checkX(cx,pcx,'parent-cx');
    checkY(cy,pcy,'parent-cy');
    // Parent edges
    checkX(r.left,parentR.left,'parent-l');
    checkX(r.right,parentR.right,'parent-r');
    checkY(r.top,parentR.top,'parent-t');
    checkY(r.bottom,parentR.bottom,'parent-b');

    for(var i=0;i<siblings.length;i++){
      var sr=siblings[i].rect;
      var scx=sr.left+sr.width/2;var scy=sr.top+sr.height/2;
      // Center-to-center
      checkX(cx,scx,'sib-cx-'+i);
      checkY(cy,scy,'sib-cy-'+i);
      // Edge-to-edge
      checkX(r.left,sr.left,'sib-ll-'+i);
      checkX(r.right,sr.right,'sib-rr-'+i);
      checkX(r.left,sr.right,'sib-lr-'+i);
      checkX(r.right,sr.left,'sib-rl-'+i);
      checkY(r.top,sr.top,'sib-tt-'+i);
      checkY(r.bottom,sr.bottom,'sib-bb-'+i);
      checkY(r.top,sr.bottom,'sib-tb-'+i);
      checkY(r.bottom,sr.top,'sib-bt-'+i);
    }

    // ── Magnetic snap with break-free ──
    // X axis
    if(bestSnapX&&bestDistX<S){
      if(!snappedX){snappedX=true;snapAccumX=0;}
      snapX=bestSnapX.correction;
    }else{
      if(snappedX){
        // We were snapped — require extra force to break
        snapAccumX+=(rawDx||0);
        if(Math.abs(snapAccumX)<SNAP_BREAK){
          snapX=0;// hold position, don't move yet
        }else{
          snappedX=false;snapAccumX=0;snapX=null;
        }
      }
    }
    // Y axis
    if(bestSnapY&&bestDistY<S){
      if(!snappedY){snappedY=true;snapAccumY=0;}
      snapY=bestSnapY.correction;
    }else{
      if(snappedY){
        snapAccumY+=(rawDy||0);
        if(Math.abs(snapAccumY)<SNAP_BREAK){
          snapY=0;
        }else{
          snappedY=false;snapAccumY=0;snapY=null;
        }
      }
    }

    // ── Apply snap correction to element ──
    if(snapX!==null&&snapX!==0){
      var curL=parseFloat(el.style.left)||0;
      el.style.left=(curL+snapX)+'px';
      snappedLeft=curL+snapX;
    }
    if(snapY!==null&&snapY!==0){
      var curT=parseFloat(el.style.top)||0;
      el.style.top=(curT+snapY)+'px';
      snappedTop=curT+snapY;
    }
    // If holding (snap=0), revert to snapped position
    if(snapX===0){el.style.left=snappedLeft+'px';}
    if(snapY===0){el.style.top=snappedTop+'px';}

    // ── Re-read rect after snap correction ──
    r=el.getBoundingClientRect();
    cx=r.left+r.width/2;cy=r.top+r.height/2;

    // ── Draw guide lines ──
    pcx=parentR.left+parentR.width/2;
    pcy=parentR.top+parentR.height/2;
    if(Math.abs(cx-pcx)<2){drawGuideLine(pcx,parentR.top,pcx,parentR.bottom,guideColor);}
    if(Math.abs(cy-pcy)<2){drawGuideLine(parentR.left,pcy,parentR.right,pcy,guideColor);}

    for(var i=0;i<siblings.length;i++){
      var sr=siblings[i].rect;
      var scx=sr.left+sr.width/2;var scy=sr.top+sr.height/2;
      // Vertical center
      if(Math.abs(cx-scx)<2){var minY=Math.min(r.top,sr.top);var maxY=Math.max(r.bottom,sr.bottom);drawGuideLine(scx,minY,scx,maxY,guideColor);}
      // Horizontal center
      if(Math.abs(cy-scy)<2){var minX=Math.min(r.left,sr.left);var maxX=Math.max(r.right,sr.right);drawGuideLine(minX,scy,maxX,scy,guideColor);}
      // Top edge
      if(Math.abs(r.top-sr.top)<2){drawGuideLine(Math.min(r.left,sr.left)-10,sr.top,Math.max(r.right,sr.right)+10,sr.top,guideColor);}
      // Bottom edge
      if(Math.abs(r.bottom-sr.bottom)<2){drawGuideLine(Math.min(r.left,sr.left)-10,sr.bottom,Math.max(r.right,sr.right)+10,sr.bottom,guideColor);}
      // Left edge
      if(Math.abs(r.left-sr.left)<2){drawGuideLine(sr.left,Math.min(r.top,sr.top)-10,sr.left,Math.max(r.bottom,sr.bottom)+10,guideColor);}
      // Right edge
      if(Math.abs(r.right-sr.right)<2){drawGuideLine(sr.right,Math.min(r.top,sr.top)-10,sr.right,Math.max(r.bottom,sr.bottom)+10,guideColor);}

      // Distance lines
      if(r.bottom<=sr.top&&Math.abs(cx-scx)<sr.width){
        var gap=sr.top-r.bottom;var mx=Math.max(r.left,sr.left)+(Math.min(r.right,sr.right)-Math.max(r.left,sr.left))/2;
        drawGuideLine(mx,r.bottom,mx,sr.top,distColor);drawDimLabel(mx+4,r.bottom+gap/2-7,Math.round(gap)+'px');
      }
      if(sr.bottom<=r.top&&Math.abs(cx-scx)<sr.width){
        var gap=r.top-sr.bottom;var mx=Math.max(r.left,sr.left)+(Math.min(r.right,sr.right)-Math.max(r.left,sr.left))/2;
        drawGuideLine(mx,sr.bottom,mx,r.top,distColor);drawDimLabel(mx+4,sr.bottom+gap/2-7,Math.round(gap)+'px');
      }
      if(r.right<=sr.left&&Math.abs(cy-scy)<sr.height){
        var gap=sr.left-r.right;var my=Math.max(r.top,sr.top)+(Math.min(r.bottom,sr.bottom)-Math.max(r.top,sr.top))/2;
        drawGuideLine(r.right,my,sr.left,my,distColor);drawDimLabel(r.right+gap/2-12,my-14,Math.round(gap)+'px');
      }
      if(sr.right<=r.left&&Math.abs(cy-scy)<sr.height){
        var gap=r.left-sr.right;var my=Math.max(r.top,sr.top)+(Math.min(r.bottom,sr.bottom)-Math.max(r.top,sr.top))/2;
        drawGuideLine(sr.right,my,r.left,my,distColor);drawDimLabel(sr.right+gap/2-12,my-14,Math.round(gap)+'px');
      }
    }

    return {snapX:snapX,snapY:snapY};
  }

  // ─── RESIZE HANDLES ───────────────────────────────
  let handleEls=[];
  let sizeTooltip=null;

  function createHandles(){
    if(handleEls.length>0)return;
    var positions=[
      {cursor:'nw-resize',pos:'tl'},{cursor:'n-resize',pos:'tc'},{cursor:'ne-resize',pos:'tr'},
      {cursor:'w-resize',pos:'ml'},{cursor:'e-resize',pos:'mr'},
      {cursor:'sw-resize',pos:'bl'},{cursor:'s-resize',pos:'bc'},{cursor:'se-resize',pos:'br'}
    ];
    for(var i=0;i<positions.length;i++){
      var h=document.createElement('div');
      h.className='__editor-handle';
      h.dataset.pos=positions[i].pos;
      h.style.cssText='position:fixed;width:8px;height:8px;background:#fff;border:1.5px solid #8A8A8A;border-radius:1px;z-index:999997;cursor:'+positions[i].cursor+';display:none;box-shadow:0 0 0 1px rgba(0,0,0,0.1);';
      h.addEventListener('mousedown',onHandleDown);
      document.body.appendChild(h);
      handleEls.push(h);
    }
    // Size tooltip
    sizeTooltip=document.createElement('div');
    sizeTooltip.id='__editor-sizetip';
    sizeTooltip.style.cssText='position:fixed;background:rgba(13,153,255,0.9);color:#fff;font-size:10px;font-family:Inter,system-ui,sans-serif;padding:2px 6px;border-radius:4px;pointer-events:none;z-index:999998;display:none;white-space:nowrap;font-weight:500;';
    document.body.appendChild(sizeTooltip);
  }

  function positionHandles(el){
    createHandles();
    if(!el){hideHandles();return;}
    var r=el.getBoundingClientRect();
    var hs=4;// half handle size
    var positions={
      tl:{x:r.left-hs,y:r.top-hs},
      tc:{x:r.left+r.width/2-hs,y:r.top-hs},
      tr:{x:r.right-hs,y:r.top-hs},
      ml:{x:r.left-hs,y:r.top+r.height/2-hs},
      mr:{x:r.right-hs,y:r.top+r.height/2-hs},
      bl:{x:r.left-hs,y:r.bottom-hs},
      bc:{x:r.left+r.width/2-hs,y:r.bottom-hs},
      br:{x:r.right-hs,y:r.bottom-hs}
    };
    for(var i=0;i<handleEls.length;i++){
      var h=handleEls[i];
      var p=positions[h.dataset.pos];
      h.style.left=p.x+'px';h.style.top=p.y+'px';
      h.style.display='block';
    }
  }

  function hideHandles(){
    for(var i=0;i<handleEls.length;i++)handleEls[i].style.display='none';
    if(sizeTooltip)sizeTooltip.style.display='none';
  }

  function onHandleDown(e){
    e.preventDefault();e.stopPropagation();
    if(selectedEls.length===0)return;
    resizeEl=selectedEls[0];
    resizeHandle=e.target.dataset.pos;
    resizeStartX=e.clientX;resizeStartY=e.clientY;
    var r=resizeEl.getBoundingClientRect();
    resizeOrigW=r.width;resizeOrigH=r.height;
    resizeOrigL=parseFloat(resizeEl.style.left)||0;
    resizeOrigT=parseFloat(resizeEl.style.top)||0;
    // Store original rect for position calc
    resizeEl.__origRect={left:r.left,top:r.top,width:r.width,height:r.height};
    isResizing=true;
  }

  function onResizeMove(e){
    if(!isResizing||!resizeEl||!resizeHandle)return;
    var dx=e.clientX-resizeStartX;
    var dy=e.clientY-resizeStartY;
    var cs=window.getComputedStyle(resizeEl);
    var newW=resizeOrigW;var newH=resizeOrigH;
    var newL=resizeOrigL;var newT=resizeOrigT;
    var pos=resizeHandle;
    // Width changes
    if(pos==='tr'||pos==='mr'||pos==='br'){newW=Math.max(20,resizeOrigW+dx);}
    if(pos==='tl'||pos==='ml'||pos==='bl'){newW=Math.max(20,resizeOrigW-dx);newL=resizeOrigL+dx;}
    // Height changes
    if(pos==='bl'||pos==='bc'||pos==='br'){newH=Math.max(20,resizeOrigH+dy);}
    if(pos==='tl'||pos==='tc'||pos==='tr'){newH=Math.max(20,resizeOrigH-dy);newT=resizeOrigT+dy;}

    // Apply shift for proportional resize
    if(e.shiftKey){
      var ratio=resizeOrigW/resizeOrigH;
      if(pos==='br'||pos==='tr'||pos==='bl'||pos==='tl'){
        var newRatio=newW/newH;
        if(newRatio>ratio){newH=newW/ratio;}
        else{newW=newH*ratio;}
        if(pos==='tl'){newL=resizeOrigL+(resizeOrigW-newW);newT=resizeOrigT+(resizeOrigH-newH);}
        if(pos==='tr'){newT=resizeOrigT+(resizeOrigH-newH);}
        if(pos==='bl'){newL=resizeOrigL+(resizeOrigW-newW);}
      }
    }

    resizeEl.style.width=Math.round(newW)+'px';
    resizeEl.style.height=Math.round(newH)+'px';

    if(pos==='tl'||pos==='ml'||pos==='bl'){
      if(cs.position==='static')resizeEl.style.position='relative';
      resizeEl.style.left=newL+'px';
    }
    if(pos==='tl'||pos==='tc'||pos==='tr'){
      if(cs.position==='static')resizeEl.style.position='relative';
      resizeEl.style.top=newT+'px';
    }

    updateOvs();positionHandles(resizeEl);

    // Show size tooltip
    if(sizeTooltip){
      var r=resizeEl.getBoundingClientRect();
      sizeTooltip.textContent=Math.round(newW)+' \\u00d7 '+Math.round(newH);
      sizeTooltip.style.left=(r.right+8)+'px';
      sizeTooltip.style.top=(r.bottom+8)+'px';
      sizeTooltip.style.display='block';
    }
  }

  function onResizeUp(){
    if(isResizing&&resizeEl){
      isDirty=true;
      _post({type:'mark-dirty'});
      sendSel(resizeEl);
    }
    isResizing=false;resizeEl=null;resizeHandle=null;
    if(sizeTooltip)sizeTooltip.style.display='none';
  }

  // ─── CORE FUNCTIONS ───────────────────────────────
  function createOv(id,color){var o=document.createElement('div');o.id=id;
    o.style.cssText='position:fixed;pointer-events:none;z-index:999995;border:1.5px solid '+color+';display:none;will-change:transform;';
    document.body.appendChild(o);return o;}

  function getPath(el){var p=[];var c=el;
    while(c&&c!==document.documentElement&&c!==document.body){
      var t=c.tagName.toLowerCase();
      if(c.id&&/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c.id)&&!c.id.startsWith('__editor')){t+='#'+c.id;}
      else{var pr=c.parentElement;if(pr){var s=pr.children;var sc=0,idx=0;
        for(var i=0;i<s.length;i++){if(s[i].tagName===c.tagName){sc++;if(s[i]===c)idx=sc;}}
        if(sc>1)t+=':nth-of-type('+idx+')';}}
      p.unshift(t);c=c.parentElement;}return p.join(' > ');}

  var SP=['display','flex-direction','justify-content','align-items','flex-wrap','gap',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'width','height','min-width','max-width','min-height','max-height',
    'font-family','font-size','font-weight','line-height','letter-spacing',
    'text-align','text-transform','text-decoration','color',
    'background-color','background-image','background-size','background-position','background-repeat',
    'opacity','border-width','border-style','border-color','border-radius',
    'box-shadow','text-shadow','filter','backdrop-filter','transform','transition',
    'overflow','position','top','right','bottom','left','z-index'];

  function getCS(el){var cs=window.getComputedStyle(el);var r={};
    for(var i=0;i<SP.length;i++)r[SP[i]]=cs.getPropertyValue(SP[i]);return r;}

  function posOv(ov,el){var r=el.getBoundingClientRect();
    ov.style.transform='translate('+r.left+'px,'+r.top+'px)';
    ov.style.width=r.width+'px';ov.style.height=r.height+'px';ov.style.left='0';ov.style.top='0';}

  function isEd(el){return !el||el.id==='__editor-hover'||el.id==='__editor-guides'||el.id==='__editor-dim'||el.id==='__editor-sizetip'||el.id==='__editor-bbox'||(el.id&&el.id.startsWith('__editor-overlay'))||(el.className&&el.className==='__editor-handle');}

  function sendSel(el){var r=el.getBoundingClientRect();var attrs={};
    for(var i=0;i<el.attributes.length;i++){var a=el.attributes[i];attrs[a.name]=a.value;}
    _post({type:'element-selected',data:{
      tagPath:getPath(el),tagName:el.tagName.toLowerCase(),text:(el.textContent||'').slice(0,300),
      styles:getCS(el),rect:{x:r.x,y:r.y,width:r.width,height:r.height},
      hasChildren:el.children.length>0,innerHTML:(el.innerHTML||'').slice(0,1000),attributes:attrs}});}

  function sendMulti(){_post({type:'multi-selected',data:{count:selectedEls.length}});}

  function clearOvs(){overlayDivs.forEach(function(o){o.style.display='none';});if(boundingBoxOv)boundingBoxOv.style.display='none';hideHandles();clearGuides();}

  function ensureBoundingBoxOv(){
    if(!boundingBoxOv){
      boundingBoxOv=document.createElement('div');boundingBoxOv.id='__editor-bbox';
      boundingBoxOv.style.cssText='position:fixed;pointer-events:none;z-index:999994;border:1.5px solid #8A8A8A;display:none;will-change:transform;';
      document.body.appendChild(boundingBoxOv);
    }
    return boundingBoxOv;
  }

  function updateOvs(){
    if(selectedEls.length===1){
      // Single selection: show individual overlay + handles, hide bounding box
      while(overlayDivs.length<1)overlayDivs.push(createOv('__editor-overlay-'+overlayDivs.length,'#8A8A8A'));
      posOv(overlayDivs[0],selectedEls[0]);overlayDivs[0].style.display='block';
      for(var i=1;i<overlayDivs.length;i++)overlayDivs[i].style.display='none';
      if(boundingBoxOv)boundingBoxOv.style.display='none';
      positionHandles(selectedEls[0]);
    }else if(selectedEls.length>1){
      // Multi-selection: hide individual overlays, show one bounding box around all
      for(var i=0;i<overlayDivs.length;i++)overlayDivs[i].style.display='none';
      // Compute bounding rect
      var minL=Infinity,minT=Infinity,maxR=-Infinity,maxB=-Infinity;
      for(var i=0;i<selectedEls.length;i++){
        var r=selectedEls[i].getBoundingClientRect();
        if(r.left<minL)minL=r.left;if(r.top<minT)minT=r.top;
        if(r.right>maxR)maxR=r.right;if(r.bottom>maxB)maxB=r.bottom;
      }
      var bb=ensureBoundingBoxOv();
      bb.style.transform='translate('+minL+'px,'+minT+'px)';
      bb.style.width=(maxR-minL)+'px';bb.style.height=(maxB-minT)+'px';
      bb.style.left='0';bb.style.top='0';bb.style.display='block';
      bb.style.borderStyle='dashed';
      hideHandles();
    }else{
      // Nothing selected
      for(var i=0;i<overlayDivs.length;i++)overlayDivs[i].style.display='none';
      if(boundingBoxOv)boundingBoxOv.style.display='none';
      hideHandles();
    }
  }

  function selEl(el,add){if(!el||el===document.body||el===document.documentElement||isEd(el))return;
    if(add){var idx=selectedEls.indexOf(el);if(idx>=0)selectedEls.splice(idx,1);else selectedEls.push(el);
      if(selectedEls.length===1)sendSel(selectedEls[0]);
      else if(selectedEls.length>1)sendMulti();
      else _post({type:'element-deselected'});
    }else{selectedEls=[el];sendSel(el);}updateOvs();clearGuides();}

  // ─── MOUSE EVENTS ────────────────────────────────
  var dragStarted=false;var lastDragDx=0;var lastDragDy=0;
  var multiDragData=[];// stores {el, origLeft, origTop} for each element in multi-drag

  // Kill native drag for all elements (fixes links, images, buttons)
  document.addEventListener('dragstart',function(e){e.preventDefault();},true);

  document.addEventListener('mousemove',function(e){
    if(isEditing)return;
    if(isResizing){onResizeMove(e);return;}
    // Handle drag
    if(isDragging&&dragEl){
      e.preventDefault();e.stopPropagation();
      var dx=e.clientX-dragStartX;var dy=e.clientY-dragStartY;
      var rawDx=dx-lastDragDx;var rawDy=dy-lastDragDy;
      lastDragDx=dx;lastDragDy=dy;
      if(!dragStarted&&(Math.abs(dx)>3||Math.abs(dy)>3)){
        dragStarted=true;
        if(hoverOverlay)hoverOverlay.style.display='none';
        // Auto-select if not already in selection
        if(selectedEls.indexOf(dragEl)<0){selEl(dragEl,false);}
        // Store original positions for all selected elements (multi-drag)
        multiDragData=[];
        for(var mi=0;mi<selectedEls.length;mi++){
          var mel=selectedEls[mi];
          var mcs=window.getComputedStyle(mel);
          if(mcs.position==='static')mel.style.position='relative';
          multiDragData.push({el:mel,origLeft:parseFloat(mcs.left==='auto'?'0':mcs.left)||0,origTop:parseFloat(mcs.top==='auto'?'0':mcs.top)||0});
        }
      }
      if(dragStarted){
        // Check if dragging near edge of iframe → cross-frame drag
        var edge=30;var vw=window.innerWidth;var vh=window.innerHeight;
        var nearEdge=e.clientX<edge||e.clientX>vw-edge||e.clientY<edge||e.clientY>vh-edge;
        if(nearEdge&&!window.__crossDragActive){
          window.__crossDragActive=true;
          var r=dragEl.getBoundingClientRect();
          _post({type:'cross-drag-start',data:{html:dragEl.outerHTML,width:r.width,height:r.height,screenX:e.screenX,screenY:e.screenY,clientX:e.clientX,clientY:e.clientY}});
          dragEl.style.opacity='0.3';
        }
        if(window.__crossDragActive){
          _post({type:'cross-drag-move',data:{screenX:e.screenX,screenY:e.screenY,clientX:e.clientX,clientY:e.clientY}});
        }
        // Move ALL selected elements by the same delta
        for(var mi=0;mi<multiDragData.length;mi++){
          var md=multiDragData[mi];
          md.el.style.left=(md.origLeft+dx)+'px';
          md.el.style.top=(md.origTop+dy)+'px';
        }
        // Smart guides on primary drag element
        showSmartGuides(dragEl,rawDx,rawDy);
        updateOvs();
      }
      return;
    }
    var now=performance.now();if(now-lastMoveTime<32)return;lastMoveTime=now;
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el||el===hoverEl||isEd(el)||el===document.body||el===document.documentElement)return;
    hoverEl=el;if(!hoverOverlay)hoverOverlay=createOv('__editor-hover','rgba(13,153,255,0.4)');
    posOv(hoverOverlay,el);hoverOverlay.style.display='block';
  },true);

  document.addEventListener('mousedown',function(e){
    if(isEditing||isResizing||e.button!==0)return;
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el||isEd(el)||el===document.body||el===document.documentElement)return;
    e.preventDefault();
    dragEl=el;dragStartX=e.clientX;dragStartY=e.clientY;
    var cs=window.getComputedStyle(el);
    dragOrigLeft=cs.left==='auto'?'0':cs.left;
    dragOrigTop=cs.top==='auto'?'0':cs.top;
    isDragging=true;dragStarted=false;lastDragDx=0;lastDragDy=0;
    snappedX=false;snappedY=false;snapAccumX=0;snapAccumY=0;
  },true);

  document.addEventListener('mouseup',function(e){
    if(isResizing){onResizeUp();return;}
    if(isDragging&&dragEl){
      if(!dragStarted){
        // It was a click, not a drag
        e.preventDefault();e.stopPropagation();
        selEl(dragEl,e.shiftKey);
      }else{
        // It was a drag
        if(window.__crossDragActive){
          window.__crossDragActive=false;
          _post({type:'cross-drag-end',data:{screenX:e.screenX,screenY:e.screenY,clientX:e.clientX,clientY:e.clientY}});
          // Restore opacity — parent will decide if element should be removed
          dragEl.style.opacity='1';
        }
        isDirty=true;
        _post({type:'mark-dirty'});
        if(selectedEls.length>1)sendMulti();
        else if(selectedEls.length===1)sendSel(selectedEls[0]);
        updateOvs();
      }
      clearGuides();
      snappedX=false;snappedY=false;
    }
    isDragging=false;dragEl=null;dragStarted=false;multiDragData=[];
  },true);

  document.addEventListener('click',function(e){
    if(isEditing)return;
    e.preventDefault();e.stopPropagation();
    return false;
  },true);

  document.addEventListener('dblclick',function(e){
    e.preventDefault();e.stopPropagation();
    var el=document.elementFromPoint(e.clientX,e.clientY);
    if(!el||el===document.body||el===document.documentElement||isEd(el))return;
    var isTxt=el.children.length===0||['H1','H2','H3','H4','H5','H6','P','SPAN','A','LI','BUTTON','LABEL','TD','TH','FIGCAPTION','BLOCKQUOTE'].includes(el.tagName);
    if(isTxt){
      isEditing=true;var _oldTxt=(el.textContent||'').trim();el.contentEditable='true';el.focus();
      el.style.outline='2px solid #8A8A8A';el.style.outlineOffset='2px';hideHandles();
      var fin=function(){el.contentEditable='false';el.style.outline='';el.style.outlineOffset='';
        isEditing=false;isDirty=true;
        _post({type:'text-edited',data:{tagPath:getPath(el),newText:el.innerHTML,oldText:_oldTxt,newTextPlain:(el.textContent||'').trim(),tagName:el.tagName.toLowerCase()}});
        el.removeEventListener('blur',fin);el.removeEventListener('keydown',onK);updateOvs();};
      var onK=function(ev){if(ev.key==='Escape'||(ev.key==='Enter'&&!ev.shiftKey)){ev.preventDefault();fin();}};
      el.addEventListener('blur',fin);el.addEventListener('keydown',onK);
    }
  },true);

  document.addEventListener('click',function(e){var a=e.target.closest('a');if(a){e.preventDefault();e.stopPropagation();}},true);

  // ─── KEYBOARD ─────────────────────────────────────
  document.addEventListener('keydown',function(e){
    if(isEditing)return;var mod=e.metaKey||e.ctrlKey;var pr=selectedEls[0];
    if(mod&&e.key==='c'&&pr){clipboardEl=pr.cloneNode(true);_post({type:'clipboard-copied'});}
    if(mod&&e.key==='v'&&clipboardEl&&pr&&pr.parentElement){var cl=clipboardEl.cloneNode(true);
      pr.parentElement.insertBefore(cl,pr.nextSibling);isDirty=true;selEl(cl,false);_post({type:'mark-dirty'});}
    if(mod&&e.key==='d'){e.preventDefault();if(pr&&pr.parentElement){var cl=pr.cloneNode(true);
      pr.parentElement.insertBefore(cl,pr.nextSibling);isDirty=true;selEl(cl,false);_post({type:'mark-dirty'});}}
    if(e.key==='Delete'||e.key==='Backspace'){if(selectedEls.length>0){
      selectedEls.forEach(function(el){if(el.parentElement){_post({type:'element-deleted',data:{tagName:el.tagName.toLowerCase(),textSnippet:(el.textContent||'').trim().slice(0,60),tagPath:getPath(el)}});el.remove();}});selectedEls=[];clearOvs();isDirty=true;
      _post({type:'element-deselected'});_post({type:'mark-dirty'});}}
    if(e.key==='Escape'){selectedEls=[];clearOvs();_post({type:'element-deselected'});}
    if(e.key==='ArrowUp'&&mod&&pr&&pr.previousElementSibling){e.preventDefault();
      pr.parentElement.insertBefore(pr,pr.previousElementSibling);isDirty=true;updateOvs();_post({type:'mark-dirty'});}
    if(e.key==='ArrowDown'&&mod&&pr&&pr.nextElementSibling){e.preventDefault();
      pr.parentElement.insertBefore(pr.nextElementSibling,pr);isDirty=true;updateOvs();_post({type:'mark-dirty'});}
    // Arrow keys to nudge position (1px or 10px with shift)
    if(!mod&&(e.key==='ArrowUp'||e.key==='ArrowDown'||e.key==='ArrowLeft'||e.key==='ArrowRight')&&pr){
      e.preventDefault();var step=e.shiftKey?10:1;
      var cs=window.getComputedStyle(pr);
      if(cs.position==='static')pr.style.position='relative';
      if(e.key==='ArrowUp')pr.style.top=(parseFloat(cs.top==='auto'?'0':cs.top)-step)+'px';
      if(e.key==='ArrowDown')pr.style.top=(parseFloat(cs.top==='auto'?'0':cs.top)+step)+'px';
      if(e.key==='ArrowLeft')pr.style.left=(parseFloat(cs.left==='auto'?'0':cs.left)-step)+'px';
      if(e.key==='ArrowRight')pr.style.left=(parseFloat(cs.left==='auto'?'0':cs.left)+step)+'px';
      isDirty=true;updateOvs();_post({type:'mark-dirty'});
      var nudgeDx=0,nudgeDy=0;
      if(e.key==='ArrowLeft')nudgeDx=-step;if(e.key==='ArrowRight')nudgeDx=step;
      if(e.key==='ArrowUp')nudgeDy=-step;if(e.key==='ArrowDown')nudgeDy=step;
      showSmartGuides(pr,nudgeDx,nudgeDy);
      clearTimeout(pr.__guideTimer);pr.__guideTimer=setTimeout(function(){clearGuides();sendSel(pr);},800);
    }
  },true);

  // ─── MESSAGES ─────────────────────────────────────
  window.addEventListener('message',function(e){
    var msg=e.data;if(!msg||!msg.type)return;var pr=selectedEls[0];
    if(msg.type==='apply-style'){if(!pr)return;var property=msg.data.property;var value=msg.data.value;
      selectedEls.forEach(function(el){el.style[property]=value;});isDirty=true;updateOvs();
      var cs=window.getComputedStyle(pr);
      var nv=cs.getPropertyValue(property.replace(/([A-Z])/g,'-$1').toLowerCase());
      _post({type:'style-applied',data:{property:property,value:value,computed:nv,tagName:pr.tagName.toLowerCase(),textSnippet:(pr.textContent||'').trim().slice(0,60),tagPath:getPath(pr)}});}
    if(msg.type==='deselect-all'){selectedEls=[];clearOvs();_post({type:'element-deselected'});}
    if(msg.type==='select-by-path'){try{var el=document.querySelector(msg.data.path);if(el)selEl(el,false);}catch(ex){}}
    if(msg.type==='delete-element'){if(selectedEls.length>0){selectedEls.forEach(function(el){if(el.parentElement){_post({type:'element-deleted',data:{tagName:el.tagName.toLowerCase(),textSnippet:(el.textContent||'').trim().slice(0,60),tagPath:getPath(el)}});el.remove();}});
      selectedEls=[];clearOvs();isDirty=true;_post({type:'element-deselected'});_post({type:'mark-dirty'});}}
    if(msg.type==='duplicate-element'){if(pr&&pr.parentElement){var cl=pr.cloneNode(true);
      pr.parentElement.insertBefore(cl,pr.nextSibling);isDirty=true;selEl(cl,false);_post({type:'mark-dirty'});}}
    if(msg.type==='move-element'){if(!pr||!pr.parentElement)return;var dir=msg.data.direction;
      if(dir==='up'&&pr.previousElementSibling)pr.parentElement.insertBefore(pr,pr.previousElementSibling);
      else if(dir==='down'&&pr.nextElementSibling)pr.parentElement.insertBefore(pr.nextElementSibling,pr);
      isDirty=true;updateOvs();_post({type:'mark-dirty'});}
    if(msg.type==='get-html'){var cl=document.documentElement.cloneNode(true);
      cl.querySelectorAll('[id^="__editor-"]').forEach(function(a){a.remove();});
      cl.querySelectorAll('.__editor-handle').forEach(function(a){a.remove();});
      _post({type:'full-html',data:{html:'<!DOCTYPE html>\\n'+cl.outerHTML}});}
    if(msg.type==='get-sections'){var b=document.body;var secs=[];
      for(var i=0;i<b.children.length;i++){var ch=b.children[i];
        if(ch.id&&ch.id.startsWith('__editor-'))continue;if(ch.className==='__editor-handle')continue;
        secs.push({tag:ch.tagName.toLowerCase(),id:ch.id||'',
          cls:ch.className?String(ch.className).split(' ').slice(0,3).join('.'):''  ,
          text:(ch.textContent||'').trim().slice(0,60),path:getPath(ch)});}
      _post({type:'sections-list',data:{sections:secs}});}
    if(msg.type==='get-layers'){
      function buildTree(el,depth){
        if(!el||isEd(el))return null;
        var tag=el.tagName?el.tagName.toLowerCase():'';
        if(!tag)return null;
        var kids=[];
        for(var i=0;i<el.children.length;i++){
          var c=buildTree(el.children[i],depth+1);
          if(c)kids.push(c);
        }
        return{tag:tag,id:el.id||'',cls:(el.className?String(el.className).split(' ')[0]:''),
          text:(el.children.length===0?(el.textContent||'').trim().slice(0,30):''),
          path:getPath(el),children:kids,depth:depth};
      }
      var body=document.body;var layers=[];
      for(var i=0;i<body.children.length;i++){
        var c=buildTree(body.children[i],0);if(c)layers.push(c);
      }
      _post({type:'layers-tree',data:{layers:layers}});}
    if(msg.type==='update-attribute'){if(!pr)return;var name=msg.data.name;var value=msg.data.value;
      if(value===''||value===null)pr.removeAttribute(name);else pr.setAttribute(name,value);
      isDirty=true;_post({type:'mark-dirty'});}
    if(msg.type==='reselect'){if(pr){sendSel(pr);updateOvs();}}
    if(msg.type==='copy-element'){if(pr){clipboardEl=pr.cloneNode(true);_post({type:'clipboard-copied'});}}
    if(msg.type==='paste-element'){if(clipboardEl&&pr&&pr.parentElement){var cl=clipboardEl.cloneNode(true);
      pr.parentElement.insertBefore(cl,pr.nextSibling);isDirty=true;selEl(cl,false);_post({type:'mark-dirty'});}}
    if(msg.type==='add-element'){
      var d=msg.data;var parent=pr?pr:document.body;
      var newEl;
      if(d.kind==='div'){newEl=document.createElement('div');newEl.style.cssText='padding:40px;background:#f0f0f0;border:1px dashed #ccc;text-align:center;color:#888;font-size:14px;';newEl.textContent='New Section';}
      else if(d.kind==='text'){newEl=document.createElement('p');newEl.style.cssText='font-size:16px;line-height:1.6;color:#333;padding:8px;';newEl.textContent='New text block. Double-click to edit.';}
      else if(d.kind==='heading'){newEl=document.createElement('h2');newEl.style.cssText='font-size:32px;font-weight:700;color:#111;padding:8px;';newEl.textContent='New Heading';}
      else if(d.kind==='image'){newEl=document.createElement('img');newEl.src='https://placehold.co/600x400/e2e8f0/64748b?text=Image';newEl.alt='placeholder';newEl.style.cssText='max-width:100%;height:auto;display:block;';}
      else if(d.kind==='button'){newEl=document.createElement('a');newEl.href='#';newEl.style.cssText='display:inline-block;padding:12px 32px;background:#0d99ff;color:#fff;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer;';newEl.textContent='Button';}
      else if(d.kind==='link'){newEl=document.createElement('a');newEl.href='#';newEl.style.cssText='color:#0d99ff;font-size:15px;text-decoration:underline;padding:4px;';newEl.textContent='Link text';}
      else if(d.kind==='list'){newEl=document.createElement('ul');newEl.style.cssText='padding:8px 8px 8px 24px;font-size:15px;line-height:1.8;color:#333;';
        for(var li=0;li<3;li++){var item=document.createElement('li');item.textContent='List item '+(li+1);newEl.appendChild(item);}}
      else if(d.kind==='video'){newEl=document.createElement('video');newEl.controls=true;newEl.style.cssText='max-width:100%;height:auto;display:block;background:#000;min-height:200px;';}
      else if(d.kind==='hr'){newEl=document.createElement('hr');newEl.style.cssText='border:none;border-top:1px solid #e2e8f0;margin:24px 0;';}
      else if(d.kind==='spacer'){newEl=document.createElement('div');newEl.style.cssText='height:64px;';}
      else if(d.kind==='columns'){
        newEl=document.createElement('div');newEl.style.cssText='display:flex;gap:16px;padding:16px;';
        for(var c=0;c<(d.cols||2);c++){var col=document.createElement('div');col.style.cssText='flex:1;padding:24px;background:#f8fafc;border-radius:8px;text-align:center;color:#64748b;font-size:14px;';col.textContent='Column '+(c+1);newEl.appendChild(col);}}
      else if(d.kind==='form'){
        newEl=document.createElement('form');newEl.style.cssText='padding:24px;max-width:480px;display:flex;flex-direction:column;gap:12px;';
        var inp=document.createElement('input');inp.type='text';inp.placeholder='Your name';inp.style.cssText='padding:10px 14px;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;outline:none;';
        var inp2=document.createElement('input');inp2.type='email';inp2.placeholder='Email address';inp2.style.cssText='padding:10px 14px;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;outline:none;';
        var btn=document.createElement('button');btn.type='submit';btn.textContent='Submit';btn.style.cssText='padding:10px 24px;background:#0d99ff;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;';
        newEl.appendChild(inp);newEl.appendChild(inp2);newEl.appendChild(btn);
        newEl.addEventListener('submit',function(ev){ev.preventDefault();});}
      else{newEl=document.createElement('div');newEl.textContent='New element';newEl.style.cssText='padding:16px;';}
      if(newEl){
        if(d.position==='inside'&&pr){pr.appendChild(newEl);}
        else if(pr&&pr.parentElement){pr.parentElement.insertBefore(newEl,pr.nextSibling);}
        else{document.body.appendChild(newEl);}
        isDirty=true;selEl(newEl,false);_post({type:'mark-dirty'});
      }
    }
    // Cross-frame: remove the dragged element from this frame
    if(msg.type==='remove-dragged-element'){
      if(pr&&pr.parentElement){pr.remove();selectedEls=[];clearOvs();isDirty=true;
        _post({type:'element-deselected'});_post({type:'mark-dirty'});}
    }
    // Cross-frame: insert element HTML into this frame
    if(msg.type==='insert-element-html'){
      var tmp=document.createElement('div');tmp.innerHTML=msg.data.html;
      var inserted=tmp.firstElementChild;
      if(inserted){document.body.appendChild(inserted);isDirty=true;selEl(inserted,false);_post({type:'mark-dirty'});}
    }
    // Proto: get bounding rect of element by CSS path
    if(msg.type==='get-proto-rect'){
      try{var pel=document.querySelector(msg.data.path);
        if(pel){var pr2=pel.getBoundingClientRect();
          _post({type:'proto-rect',data:{path:msg.data.path,x:pr2.left,y:pr2.top,w:pr2.width,h:pr2.height}});}
      }catch(ex){}
    }
  });

  // Resize is handled in the main mousemove/mouseup listeners above

  function refreshOvs(){
    updateOvs();
    if(hoverEl&&hoverOverlay)posOv(hoverOverlay,hoverEl);
  }
  window.addEventListener('scroll',refreshOvs,{passive:true,capture:true});
  window.addEventListener('resize',refreshOvs,{passive:true});
  document.addEventListener('scroll',refreshOvs,{passive:true,capture:true});
  // Notify parent when this frame is clicked (to set active frame)
  document.addEventListener('mousedown',function(){_post({type:'frame-clicked'});},false);
  // Report content height so parent can size the frame to fit all content.
  // IMPORTANT: measure against a NEUTRALIZED viewport so that full-height
  // sections (min-height:100vh / height:100vh — very common in React landing
  // pages) don't create a feedback loop where the frame grows forever on the
  // Y axis. We temporarily inject a style that caps viewport-relative heights,
  // measure the true content height, then remove it.
  var _measuring=false;
  var _lastReported=0;
  function _measureNatural(){
    var st=document.getElementById('__editor-measure-cap');
    if(!st){
      st=document.createElement('style');
      st.id='__editor-measure-cap';
      st.textContent='*{min-height:0!important;}html,body{min-height:0!important;height:auto!important;}';
    }
    document.documentElement.appendChild(st);
    // Force reflow, then read the natural content bottom
    var h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight,600);
    // Remove the cap immediately so the real layout is restored
    if(st.parentNode)st.parentNode.removeChild(st);
    return h;
  }
  function _reportHeight(){
    if(_measuring)return;
    _measuring=true;
    var h=_measureNatural();
    _measuring=false;
    if(Math.abs(h-_lastReported)<4)return; // ignore tiny jitter
    _lastReported=h;
    _post({type:'content-height',data:{height:h}});
  }
  // Debounced reporter to coalesce bursts of mutations
  var _rhTimer=null;
  function _scheduleReport(){
    if(_rhTimer)clearTimeout(_rhTimer);
    _rhTimer=setTimeout(_reportHeight,120);
  }
  // Report height on load, on real DOM mutations, and after images load.
  // We deliberately DO NOT observe body resize or window resize: those fire
  // whenever the parent resizes the frame and would re-trigger the loop.
  _scheduleReport();
  new MutationObserver(function(){_scheduleReport();}).observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});
  // Also re-report after images load
  document.querySelectorAll('img').forEach(function(img){img.addEventListener('load',_scheduleReport);});
  _post({type:'editor-ready'});
})();
`;

const camelToKebab = (s: string) => s.replace(/([A-Z])/g, '-$1').toLowerCase();
const toHex = (val: string) => {
  if (!val) return '#000000';
  if (val.startsWith('#')) return val.slice(0, 7);
  const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  return '#000000';
};

// ─── TAG ICONS (Figma-style layer icons) ─────────────────────────────────────
function TagIcon({ tag }: { tag: string }) {
  const s = { width: 12, height: 12, fill: 'none', stroke: FG.textDim, strokeWidth: 1.5 };
  switch (tag) {
    case 'div': case 'section': case 'article': case 'main': case 'aside': case 'header': case 'footer': case 'nav':
      return <svg {...s} viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>;
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return <svg {...s} viewBox="0 0 16 16"><path d="M4 3v10M12 3v10M4 8h8"/></svg>;
    case 'p': case 'span': case 'label':
      return <svg {...s} viewBox="0 0 16 16"><path d="M3 4h10M3 8h8M3 12h6"/></svg>;
    case 'a':
      return <svg {...s} viewBox="0 0 16 16"><path d="M6 10l4-4M5 8L3 10a2 2 0 002.8 2.8L8 11M8 5l2.2-2.2A2 2 0 0113 5.6L11 8"/></svg>;
    case 'img':
      return <svg {...s} viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6" r="1"/><path d="M2 11l3-3 2 2 3-3 4 4"/></svg>;
    case 'button':
      return <svg {...s} viewBox="0 0 16 16"><rect x="2" y="5" width="12" height="6" rx="2"/></svg>;
    case 'ul': case 'ol': case 'li':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="4" cy="5" r="1" fill={FG.textDim}/><path d="M7 5h6M7 8h6M7 11h5"/><circle cx="4" cy="8" r="1" fill={FG.textDim}/><circle cx="4" cy="11" r="1" fill={FG.textDim}/></svg>;
    case 'form': case 'input': case 'textarea': case 'select':
      return <svg {...s} viewBox="0 0 16 16"><rect x="2" y="5" width="12" height="6" rx="1"/><path d="M5 8h6"/></svg>;
    case 'video': case 'iframe':
      return <svg {...s} viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M7 6l3 2-3 2z" fill={FG.textDim}/></svg>;
    case 'svg':
      return <svg {...s} viewBox="0 0 16 16"><path d="M8 2l5.2 9H2.8L8 2z"/></svg>;
    default:
      return <svg {...s} viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>;
  }
}

// ─── FIGMA INPUT (clean minimal) ─────────────────────────────────────────────
const FInput = memo(function FInput({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  const [local, setLocal] = useState(value);
  const prevRef = useRef(value);
  if (prevRef.current !== value) { prevRef.current = value; if (local !== value) setLocal(value); }
  return (
    <div className="flex items-center gap-1">
      <span style={{ color: FG.textDim, fontSize: 10, width: 14, textAlign: 'center', flexShrink: 0 }}>{label}</span>
      <input type="text" value={local} onChange={e => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onChange(local); }}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(local); (e.target as HTMLInputElement).blur(); } }}
        style={{ background: FG.surface, color: FG.text, border: 'none', borderRadius: 4, fontSize: 11, padding: '4px 6px',
          width: '100%', outline: 'none', fontFamily: 'Inter, system-ui, sans-serif' }} />
      {suffix && <span style={{ color: FG.textMuted, fontSize: 9, flexShrink: 0 }}>{suffix}</span>}
    </div>
  );
});

// ─── EFFECT SELECT (Figma dropdown) ──────────────────────────────────────────
const EffectSelect = memo(function EffectSelect({ label, propKey, value, applyStyle }: any) {
  const presets = EFFECT_PRESETS[propKey] || [];
  const [custom, setCustom] = useState(false);
  const [local, setLocal] = useState(value);
  const prevRef = useRef(value);
  if (prevRef.current !== value) { prevRef.current = value; if (local !== value) setLocal(value); }
  const matched = presets.find(p => p.value === value);
  return (
    <div style={{ marginBottom: 4 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 2 }}>
        <span style={{ color: FG.textDim, fontSize: 10 }}>{label}</span>
        <button onClick={() => setCustom(!custom)} style={{ color: FG.accent, fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {custom ? 'presets' : 'custom'}
        </button>
      </div>
      {custom ? (
        <input type="text" value={local} onChange={e => setLocal(e.target.value)}
          onBlur={() => { if (local !== value) applyStyle(propKey, local); }}
          onKeyDown={e => { if (e.key === 'Enter') { applyStyle(propKey, local); (e.target as HTMLInputElement).blur(); } }}
          style={{ background: FG.surface, color: FG.text, border: 'none', borderRadius: 4, fontSize: 11, padding: '4px 6px', width: '100%', outline: 'none' }} />
      ) : (
        <select value={matched ? matched.value : ''} onChange={e => { applyStyle(propKey, e.target.value); setLocal(e.target.value); }}
          style={{ background: FG.surface, color: FG.text, border: 'none', borderRadius: 4, fontSize: 11, padding: '4px 6px', width: '100%', outline: 'none' }}>
          {presets.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          {!matched && value && <option value="">Custom</option>}
        </select>
      )}
    </div>
  );
});

// ─── MAIN EDITOR ─────────────────────────────────────────────────────────────
export default function Editor() {
  const params = useParams<{ id: string }>();
  const id = params.id!;
  const [, navigate] = useLocation();

  // Data
  const [pages, setPages] = useState<PageData[]>([]);
  const [activeSlug, setActiveSlug] = useState('index'); // which frame is focused
  const [loading, setLoading] = useState(true);
  const pageHtmlMapRef = useRef<Record<string, string>>({});
  const pageLangMapRef = useRef<Record<string, string>>({});
  const iframeRefsMap = useRef<Record<string, HTMLIFrameElement | null>>({});
  const loadedSlugsRef = useRef<Set<string>>(new Set());
  // Tracks which page-frames have actually rendered visible content (per-slug),
  // so we can show a spinner overlay on each frame until it stops being blank.
  const [readySlugs, setReadySlugs] = useState<Set<string>>(new Set());
  // React projects: pages served via live proxy (not editable HTML). Their edits
  // are captured as visual changes and persisted by patching the React source
  // through the AI edit pipeline instead of saving mutated DOM HTML.
  const reactSlugsRef = useRef<Set<string>>(new Set());
  const pendingEditsRef = useRef<Record<string, Array<{ kind: 'text' | 'style' | 'delete'; tagName?: string; oldText?: string; newText?: string; textSnippet?: string; property?: string; value?: string }>>>({});

  // Selection
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [multiCount, setMultiCount] = useState(0);

  // UI state
  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [tool, setTool] = useState<Tool>('move');
  const toolRef = useRef<Tool>('move');
  useEffect(() => { toolRef.current = tool; }, [tool]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirtyCount, setDirtyCount] = useState(0);
  const dirtySetRef = useRef<Set<string>>(new Set());
  const [sections, setSections] = useState<any[]>([]);
  const [layers, setLayers] = useState<any[]>([]);

  const [clipNotif, setClipNotif] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const publishBtnRef = useRef<HTMLButtonElement | null>(null);

  // Canvas pan & zoom
  const [canvasX, setCanvasX] = useState(0);
  const [canvasY, setCanvasY] = useState(0);
  const [zoom, setZoom] = useState(0.6);
  const [frameHeights, setFrameHeights] = useState<Record<string, number>>({});
  // Tracks consecutive height growth per slug to detect & freeze runaway loops.
  const heightGrowthRef = useRef<Record<string, { count: number; last: number }>>({});
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, cx: 0, cy: 0 });
  const spaceDown = useRef(false);

  // Cross-frame drag
  const [crossDrag, setCrossDrag] = useState<{ html: string; sourceSlug: string; ghostX: number; ghostY: number; width: number; height: number } | null>(null);
  const crossDragRef = useRef<typeof crossDrag>(null);

  // Prototype links (arrows between elements and frames)
  const [protoLinks, setProtoLinks] = useState<ProtoLink[]>([]);
  const [protoDragging, setProtoDragging] = useState<{ sourceSlug: string; sourcePath: string; sourceRect: { x: number; y: number; w: number; h: number }; mouseX: number; mouseY: number } | null>(null);

  // Free frames on canvas
  const [freeFrames, setFreeFrames] = useState<FreeFrame[]>([]);
  const [drawingFrame, setDrawingFrame] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);

  // History
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIdxRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const activeSlugRef = useRef(activeSlug);
  activeSlugRef.current = activeSlug;
  const sendToFrame = useCallback((slug: string, msg: any) => {
    iframeRefsMap.current[slug]?.contentWindow?.postMessage(msg, '*');
  }, []);
  const sendToActive = useCallback((msg: any) => {
    sendToFrame(activeSlugRef.current, msg);
  }, [sendToFrame]);
  const snapshotTimerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const markDirty = useCallback(() => {
    dirtySetRef.current.add(activeSlugRef.current);
    setDirtyCount(dirtySetRef.current.size);
  }, []);

  const requestSnapshot = useCallback((slug?: string) => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      const targetSlug = slug || activeSlugRef.current;
      sendToFrame(targetSlug, { type: 'get-html' });
    }, 600);
  }, [sendToFrame]);

  // Load pages
  useEffect(() => {
    setLoading(true);
    Promise.all([api.companies.pages(id), api.companies.languages.get(id)])
      .then(([pagesRes, langsRes]: any[]) => {
        const allPages = pagesRes?.pages || [];
        const langs: string[] = langsRes?.languages || [];
        const defaultLang = langs[0] || '';
        const slugMap = new Map<string, any>();
        for (const p of allPages) {
          if (p.lang !== defaultLang && p.lang && p.lang !== '') continue;
          const ex = slugMap.get(p.slug);
          if (!ex || (p.lang === defaultLang)) slugMap.set(p.slug, p);
        }
        const dp = Array.from(slugMap.values()).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        setPages(dp);
        const map: Record<string, string> = {}, lmap: Record<string, string> = {};
        dp.forEach((p: any) => { map[p.slug] = p.htmlContent; lmap[p.slug] = p.lang || ''; });
        pageHtmlMapRef.current = map; pageLangMapRef.current = lmap;
        if (dp.length > 0) setActiveSlug(dp.find((p: any) => p.slug === 'index') ? 'index' : dp[0].slug);
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [id]);

  const getEditableHtml = useCallback((html: string, slug: string) => {
    const s = `<script id="__editor-injected-script">${IFRAME_SCRIPT_FN(slug)}</script>`;
    // Force no scroll inside iframe — content height is reported to parent
    const noScroll = `<style id="__editor-no-scroll">html,body{overflow:hidden!important;}</style>`;
    const injected = noScroll + s;
    return html.includes('</body>') ? html.replace('</body>', injected + '</body>') : html + injected;
  }, []);

  const REACT_PLACEHOLDER = '<!-- React project: see /project-files -->';

  // Load all iframes when pages are ready
  const loadIframe = useCallback((slug: string) => {
    const html = pageHtmlMapRef.current[slug];
    if (!html) return;
    const iframe = iframeRefsMap.current[slug];
    if (!iframe || loadedSlugsRef.current.has(slug)) return;
    loadedSlugsRef.current.add(slug);

    // React projects: use proxy URL instead of srcdoc. The proxy is same-origin,
    // so once the app loads we inject the editor script directly into the live
    // document — making elements selectable and text/style editable, exactly
    // like static pages. Edits are persisted later by patching the React source.
    if (html.trim() === REACT_PLACEHOLDER) {
      reactSlugsRef.current.add(slug);
      // Vite serves the app under base /api/companies/:id/preview/ ; a route like
      // /about resolves to /api/companies/:id/preview/about. index → the base root.
      const pagePath = slug === 'index' || slug === '' ? '/' : `/${slug}`;
      const injectEditor = () => {
        try {
          const doc = iframe.contentDocument;
          if (!doc || !doc.body) return;
          if (doc.getElementById('__editor-injected-script')) return; // already injected
          const noScroll = doc.createElement('style');
          noScroll.id = '__editor-no-scroll';
          noScroll.textContent = 'html,body{overflow:hidden!important;}';
          doc.head?.appendChild(noScroll);
          const sc = doc.createElement('script');
          sc.id = '__editor-injected-script';
          sc.textContent = IFRAME_SCRIPT_FN(slug);
          doc.body.appendChild(sc);
        } catch { /* cross-origin or not ready — ignored */ }
      };
      iframe.addEventListener('load', () => {
        // React mounts asynchronously; inject on load, then retry shortly after
        // so document-level listeners cover content rendered right after mount.
        injectEditor();
        setTimeout(injectEditor, 400);
        setTimeout(injectEditor, 1200);
      });
      iframe.src = `/api/companies/${id}/preview${pagePath}`;
      return;
    }

    const eh = getEditableHtml(html, slug);
    iframe.srcdoc = eh;
  }, [getEditableHtml, id]);

  // Set iframe ref and load it
  const setIframeRef = useCallback((slug: string, el: HTMLIFrameElement | null) => {
    if (el && iframeRefsMap.current[slug] !== el) {
      iframeRefsMap.current[slug] = el;
      // Load after mount
      setTimeout(() => loadIframe(slug), 0);
    }
  }, [loadIframe]);

  // Messages from iframes
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data; if (!msg || !msg.type) return;
      const msgSlug = msg.__slug__ || '';
      const isActive = msgSlug === activeSlugRef.current;

      switch (msg.type) {
        case 'frame-clicked':
          if (msgSlug && msgSlug !== activeSlugRef.current) {
            // Deselect in previously active frame
            sendToFrame(activeSlugRef.current, { type: 'deselect-all' });
            setActiveSlug(msgSlug);
            setSelected(null); setMultiCount(0);
            // Get layers from the newly active frame
            sendToFrame(msgSlug, { type: 'get-layers' });
          }
          break;
        case 'element-selected':
          if (isActive) {
            setSelected(msg.data); setMultiCount(0); setRightOpen(true);
            // In proto mode, start proto dragging from the selected element
            if (toolRef.current === 'proto' && msg.data?.rect && msgSlug) {
              const r = msg.data.rect;
              const srcIdx = pages.findIndex(p => p.slug === msgSlug);
              const srcFrameW = DEVICE_WIDTHS[device];
              const srcXOff = srcIdx * (srcFrameW + FRAME_GAP);
              // Initial mouse position = right edge of element in canvas coords
              const initMx = canvasX + (srcXOff + r.x + r.width) * zoom;
              const initMy = canvasY + (r.y + r.height / 2) * zoom;
              setProtoDragging({
                sourceSlug: msgSlug,
                sourcePath: msg.data.tagPath || '',
                sourceRect: { x: r.x, y: r.y, w: r.width, h: r.height },
                mouseX: initMx, mouseY: initMy,
              });
            }
          }
          break;
        case 'multi-selected': if (isActive) { setSelected(null); setMultiCount(msg.data.count); } break;
        case 'element-deselected': if (isActive) { setSelected(null); setMultiCount(0); } break;
        case 'text-edited':
          if (msgSlug) { dirtySetRef.current.add(msgSlug); setDirtyCount(dirtySetRef.current.size); }
          if (msgSlug && reactSlugsRef.current.has(msgSlug) && msg.data) {
            const oldT = (msg.data.oldText || '').trim();
            const newT = (msg.data.newTextPlain || '').trim();
            if (oldT !== newT) {
              (pendingEditsRef.current[msgSlug] ||= []).push({ kind: 'text', tagName: msg.data.tagName, oldText: oldT, newText: newT });
            }
          }
          requestSnapshot(msgSlug); break;
        case 'style-applied':
          if (msgSlug) { dirtySetRef.current.add(msgSlug); setDirtyCount(dirtySetRef.current.size); }
          if (msgSlug && reactSlugsRef.current.has(msgSlug) && msg.data) {
            (pendingEditsRef.current[msgSlug] ||= []).push({ kind: 'style', tagName: msg.data.tagName, textSnippet: (msg.data.textSnippet || '').trim(), property: msg.data.property, value: msg.data.value });
          }
          requestSnapshot(msgSlug);
          if (isActive) sendToActive({ type: 'reselect' }); break;
        case 'element-deleted':
          if (msgSlug) { dirtySetRef.current.add(msgSlug); setDirtyCount(dirtySetRef.current.size); }
          if (msgSlug && reactSlugsRef.current.has(msgSlug) && msg.data) {
            (pendingEditsRef.current[msgSlug] ||= []).push({ kind: 'delete', tagName: msg.data.tagName, textSnippet: (msg.data.textSnippet || '').trim() });
          }
          requestSnapshot(msgSlug); break;
        case 'mark-dirty':
          if (msgSlug) { dirtySetRef.current.add(msgSlug); setDirtyCount(dirtySetRef.current.size); }
          requestSnapshot(msgSlug); break;
        case 'content-height':
          if (msgSlug && msg.data?.height) {
            setReadySlugs(prev => (prev.has(msgSlug) ? prev : new Set(prev).add(msgSlug)));
            const reported = Math.min(msg.data.height, MAX_FRAME_HEIGHT);
            setFrameHeights(prev => {
              const old = prev[msgSlug] || 0;
              if (Math.abs(old - reported) < 5) return prev; // avoid unnecessary re-renders
              // Runaway guard: if the height keeps growing across many
              // consecutive reports (symptom of a vh feedback loop), freeze it.
              const track = heightGrowthRef.current[msgSlug] || { count: 0, last: 0 };
              if (reported > old && reported > track.last) {
                track.count += 1;
                track.last = reported;
                heightGrowthRef.current[msgSlug] = track;
                if (track.count > 6) return prev; // frozen — stop the runaway
              } else {
                heightGrowthRef.current[msgSlug] = { count: 0, last: reported };
              }
              return { ...prev, [msgSlug]: reported };
            });
          }
          break;
        case 'clipboard-copied': setClipNotif('Copied!'); setTimeout(() => setClipNotif(''), 1200); break;
        case 'full-html': {
          let h = msg.data.html;
          h = h.replace(/<style id="__editor-no-scroll">[\s\S]*?<\/style>/g, '');
          h = h.replace(/<script id="__editor-injected-script">[\s\S]*?<\/script>/g, '');
          h = h.replace(/<div id="__editor-[^"]*"[\s\S]*?<\/div>/g, '');
          const slug = msgSlug || activeSlugRef.current;
          pageHtmlMapRef.current = { ...pageHtmlMapRef.current, [slug]: h };
          const hist = historyRef.current;
          const newH = hist.slice(0, historyIdxRef.current + 1);
          newH.push({ slug, html: h }); if (newH.length > 50) newH.shift();
          historyRef.current = newH;
          historyIdxRef.current = Math.min(newH.length - 1, 49);
          setCanUndo(historyIdxRef.current > 0); setCanRedo(false);
          if (isActive) sendToFrame(slug, { type: 'get-layers' });
          break;
        }
        case 'editor-ready':
          if (msgSlug) {
            sendToFrame(msgSlug, { type: 'get-sections' });
            if (isActive) sendToFrame(msgSlug, { type: 'get-layers' });
          }
          break;
        case 'sections-list': if (isActive) setSections(msg.data.sections); break;
        case 'layers-tree': if (isActive) setLayers(msg.data.layers); break;

        // Cross-frame drag
        case 'cross-drag-start': {
          // Convert iframe-relative screenX/Y to parent clientX/Y
          const srcIframe = iframeRefsMap.current[msgSlug];
          const iframeRect = srcIframe?.getBoundingClientRect();
          const gx = iframeRect ? iframeRect.left + msg.data.clientX : msg.data.screenX;
          const gy = iframeRect ? iframeRect.top + msg.data.clientY : msg.data.screenY;
          crossDragRef.current = { html: msg.data.html, sourceSlug: msgSlug, ghostX: gx, ghostY: gy, width: msg.data.width * zoom, height: msg.data.height * zoom };
          setCrossDrag(crossDragRef.current);
          break;
        }
        case 'cross-drag-move': {
          if (crossDragRef.current) {
            const srcIframe2 = iframeRefsMap.current[crossDragRef.current.sourceSlug];
            const iframeRect2 = srcIframe2?.getBoundingClientRect();
            const gx2 = iframeRect2 ? iframeRect2.left + msg.data.clientX : msg.data.screenX;
            const gy2 = iframeRect2 ? iframeRect2.top + msg.data.clientY : msg.data.screenY;
            crossDragRef.current = { ...crossDragRef.current, ghostX: gx2, ghostY: gy2 };
            setCrossDrag({ ...crossDragRef.current });
          }
          break;
        }
        case 'cross-drag-end': {
          const cd = crossDragRef.current;
          if (cd && canvasRef.current) {
            const canvasRect = canvasRef.current.getBoundingClientRect();
            const srcIframe3 = iframeRefsMap.current[cd.sourceSlug];
            const iframeRect3 = srcIframe3?.getBoundingClientRect();
            const mouseX = iframeRect3 ? iframeRect3.left + msg.data.clientX : msg.data.screenX;
            const mouseY = iframeRect3 ? iframeRect3.top + msg.data.clientY : msg.data.screenY;
            let targetSlug: string | null = null;
            for (const p of pages) {
              const idx = pages.indexOf(p);
              const frameW = DEVICE_WIDTHS[device];
              const fH = frameHeights[p.slug] || FRAME_HEIGHT;
              const xOff = idx * (frameW + FRAME_GAP);
              const frameLeft = canvasRect.left + canvasX + xOff * zoom;
              const frameTop = canvasRect.top + canvasY;
              const frameRight = frameLeft + frameW * zoom;
              const frameBottom = frameTop + fH * zoom;
              // Use screen coordinates approximation
              if (mouseX >= frameLeft && mouseX <= frameRight && mouseY >= frameTop && mouseY <= frameBottom && p.slug !== cd.sourceSlug) {
                targetSlug = p.slug;
                break;
              }
            }
            if (targetSlug) {
              // Insert into target frame and remove from source
              sendToFrame(targetSlug, { type: 'insert-element-html', data: { html: cd.html } });
              sendToFrame(cd.sourceSlug, { type: 'remove-dragged-element' });
              setActiveSlug(targetSlug);
              sendToFrame(targetSlug, { type: 'get-layers' });
            }
          }
          crossDragRef.current = null;
          setCrossDrag(null);
          break;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [markDirty, requestSnapshot, sendToFrame, sendToActive]);

  const applyStyle = useCallback((property: string, value: string) => {
    sendToActive({ type: 'apply-style', data: { property, value } });
  }, []);
  const colorTimerRef = useRef<any>(null);
  const applyStyleDebounced = useCallback((property: string, value: string) => {
    if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
    colorTimerRef.current = setTimeout(() => applyStyle(property, value), 50);
  }, [applyStyle]);

  // Save — get fresh HTML from ALL dirty iframes then persist
  const saveAll = useCallback(async () => {
    setSaving(true);
    const allDirty = Array.from(dirtySetRef.current);
    // Partition: React pages (edited via source-patch AI) vs static HTML pages (edited via DOM serialization)
    const reactSlugs = allDirty.filter(s => reactSlugsRef.current.has(s));
    const staticSlugs = allDirty.filter(s => !reactSlugsRef.current.has(s));

    // ─── Static HTML pages: serialize mutated DOM back to htmlContent ───
    const received = new Set<string>();
    const getAll = () => new Promise<void>((resolve) => {
      if (staticSlugs.length === 0) { resolve(); return; }
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'full-html' && e.data?.__slug__) {
          let h = e.data.data.html;
          h = h.replace(/<style id="__editor-no-scroll">[\s\S]*?<\/style>/g, '');
          h = h.replace(/<script id="__editor-injected-script">[\s\S]*?<\/script>/g, '');
          h = h.replace(/<div id="__editor-[^"]*"[\s\S]*?<\/div>/g, '');
          pageHtmlMapRef.current[e.data.__slug__] = h;
          received.add(e.data.__slug__);
          if (received.size >= staticSlugs.length) { window.removeEventListener('message', onMsg); resolve(); }
        }
      };
      window.addEventListener('message', onMsg);
      staticSlugs.forEach(slug => sendToFrame(slug, { type: 'get-html' }));
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(); }, 3000);
    });
    await getAll();
    const staticProms = staticSlugs.map(slug => {
      const html = pageHtmlMapRef.current[slug], lang = pageLangMapRef.current[slug];
      return html ? api.companies.updatePageHtml(id, slug, html, lang) : Promise.resolve();
    });

    // ─── React pages: compose NL instruction from captured edits → AI source patch ───
    const reactProms = reactSlugs.map(async (slug) => {
      const edits = pendingEditsRef.current[slug] || [];
      if (edits.length === 0) return;
      const lines: string[] = [];
      for (const ed of edits) {
        if (ed.kind === 'text' && ed.oldText != null && ed.newText != null) {
          lines.push(`Replace the text "${ed.oldText.trim()}" with "${ed.newText.trim()}".`);
        } else if (ed.kind === 'style' && ed.property && ed.value) {
          const where = ed.textSnippet ? ` of the <${ed.tagName || 'element'}> element containing "${ed.textSnippet}"` : ` of the <${ed.tagName || 'element'}> element`;
          lines.push(`Apply the CSS style \`${ed.property}: ${ed.value}\`${where}.`);
        } else if (ed.kind === 'delete') {
          const where = ed.textSnippet ? ` containing "${ed.textSnippet}"` : '';
          lines.push(`Delete the <${ed.tagName || 'element'}> element${where}.`);
        }
      }
      if (lines.length === 0) return;
      const instruction = `On the "${slug}" page, apply exactly these visual changes without changing anything else:\n- ${lines.join('\n- ')}`;
      // Pas de retour visuel sur ce que fait l'IA pendant la sauvegarde :
      // l'utilisateur ne veut voir aucun message de progression de l'IA.
      const res = await api.companies.projectEdit(id, instruction, slug, undefined, edits);
      if (!res.ok) {
        console.error('[editor] projectEdit failed for', slug, res.error);
        throw new Error(res.error || 'Edit failed');
      }
      delete pendingEditsRef.current[slug];
      // Pas de reload forcé de l'iframe : les modifications sont déjà appliquées
      // en direct dans le DOM par le script injecté, et le code source est patché
      // côté serveur. Recharger l'iframe faisait clignoter la page en blanc
      // (rebuild Vite) — on garde donc le rendu courant.
    });

    try {
      await Promise.all([...staticProms, ...reactProms]);
      dirtySetRef.current.clear(); setDirtyCount(0);
      setClipNotif('Saved');
    } catch {
      // keep dirty state so user can retry
      setClipNotif('Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setClipNotif(''), 1500);
    }
  }, [id, sendToFrame]);

  const reloadFrame = useCallback((slug: string) => {
    loadedSlugsRef.current.delete(slug);
    setReadySlugs(prev => { if (!prev.has(slug)) return prev; const next = new Set(prev); next.delete(slug); return next; });
    loadIframe(slug);
  }, [loadIframe]);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const e = historyRef.current[historyIdxRef.current];
    pageHtmlMapRef.current = { ...pageHtmlMapRef.current, [e.slug]: e.html };
    reloadFrame(e.slug);
    setActiveSlug(e.slug);
    setCanUndo(historyIdxRef.current > 0); setCanRedo(true); markDirty();
  }, [markDirty, reloadFrame]);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const e = historyRef.current[historyIdxRef.current];
    pageHtmlMapRef.current = { ...pageHtmlMapRef.current, [e.slug]: e.html };
    reloadFrame(e.slug);
    setActiveSlug(e.slug);
    setCanUndo(true); setCanRedo(historyIdxRef.current < historyRef.current.length - 1); markDirty();
  }, [markDirty, reloadFrame]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space' && !e.repeat) { spaceDown.current = true; }
      if (mod && e.key === 's') { e.preventDefault(); saveAll(); }
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (mod && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      if (mod && e.key === 'y') { e.preventDefault(); redo(); }
      if (mod && e.key === 'c') sendToActive({ type: 'copy-element' });
      if (mod && e.key === 'v') sendToActive({ type: 'paste-element' });
      if (mod && e.key === 'd') { e.preventDefault(); sendToActive({ type: 'duplicate-element' }); }
      if (e.key === 'Escape') { setSelected(null); setMultiCount(0); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || ''))
        sendToActive({ type: 'delete-element' });
      // Tool shortcuts
      if (e.key === 'v' && !mod) setTool('move');
      if (e.key === 'h' && !mod) setTool('hand');
      if (e.key === 't' && !mod) setTool('text');
      if (e.key === 'f' && !mod) setTool('frame');
      if (e.key === 'p' && !mod) setTool('proto');
      // Zoom
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(z => Math.min(z + 0.1, 3)); }
      if (mod && e.key === '-') { e.preventDefault(); setZoom(z => Math.max(z - 0.1, 0.1)); }
      if (mod && e.key === '0') { e.preventDefault(); setZoom(1); setCanvasX(0); setCanvasY(0); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false; };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('keyup', up); };
  }, [saveAll, undo, redo]);

  // Canvas pan/zoom + frame-draw + proto-drag handlers
  const isDrawingFrameRef = useRef(false);
  const frameDrawStart = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.002;
        setZoom(z => Math.max(0.1, Math.min(3, z + delta)));
      } else {
        setCanvasX(x => x - e.deltaX);
        setCanvasY(y => y - e.deltaY);
      }
    };
    const onDown = (e: MouseEvent) => {
      // Pan (middle click or space+left or hand tool)
      if (e.button === 1 || (e.button === 0 && (spaceDown.current || tool === 'hand'))) {
        e.preventDefault();
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, cx: 0, cy: 0 };
        canvas.style.cursor = 'grabbing';
        return;
      }
      // Frame tool — start drawing rectangle (canvas-relative coords)
      if (e.button === 0 && tool === 'frame') {
        e.preventDefault();
        isDrawingFrameRef.current = true;
        const cr = canvas.getBoundingClientRect();
        const rx = e.clientX - cr.left;
        const ry = e.clientY - cr.top;
        frameDrawStart.current = { x: rx, y: ry };
        setDrawingFrame({ startX: rx, startY: ry, curX: rx, curY: ry });
        return;
      }
      // Proto tool — clicking on canvas (not iframe) starts proto if we have a selected element
      if (e.button === 0 && tool === 'proto') {
        // Proto dragging is initiated from iframe via message, not from canvas click
        return;
      }
    };
    const onMove = (e: MouseEvent) => {
      // Panning
      if (isPanning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        panStart.current.x = e.clientX;
        panStart.current.y = e.clientY;
        setCanvasX(x => x + dx);
        setCanvasY(y => y + dy);
        return;
      }
      // Frame drawing (canvas-relative coords)
      if (isDrawingFrameRef.current) {
        const cr = canvas.getBoundingClientRect();
        setDrawingFrame(prev => prev ? { ...prev, curX: e.clientX - cr.left, curY: e.clientY - cr.top } : null);
        return;
      }
      // Proto dragging (canvas-relative coords for the bezier line)
      setProtoDragging(prev => {
        if (!prev) return null;
        const cr = canvas.getBoundingClientRect();
        return { ...prev, mouseX: e.clientX - cr.left, mouseY: e.clientY - cr.top };
      });
    };
    const onUp = (e: MouseEvent) => {
      // Panning end
      if (isPanning.current) {
        isPanning.current = false;
        canvas.style.cursor = tool === 'hand' ? 'grab' : tool === 'frame' ? 'crosshair' : 'default';
        return;
      }
      // Frame drawing end — create a FreeFrame
      if (isDrawingFrameRef.current) {
        isDrawingFrameRef.current = false;
        const df = { startX: frameDrawStart.current.x, startY: frameDrawStart.current.y, curX: e.clientX, curY: e.clientY };
        const w = Math.abs(df.curX - df.startX);
        const h = Math.abs(df.curY - df.startY);
        if (w > 20 && h > 20) {
          // Coords are already canvas-relative, convert to canvas content coords
          const left = Math.min(df.startX, df.curX);
          const top = Math.min(df.startY, df.curY);
          setFreeFrames(prev => [...prev, {
            id: `ff-${Date.now()}`,
            x: (left - canvasX) / zoom,
            y: (top - canvasY) / zoom,
            width: w / zoom,
            height: h / zoom,
            label: `Frame ${prev.length + 1}`,
            color: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'][prev.length % 5],
          }]);
        }
        setDrawingFrame(null);
        return;
      }
      // Proto dragging end — check if mouse is over a frame, create link
      setProtoDragging(prev => {
        if (!prev) return null;
        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        // Hit-test which page frame the mouse is over
        for (const p of pages) {
          const idx = pages.indexOf(p);
          const frameW = DEVICE_WIDTHS[device];
          const fH = frameHeights[p.slug] || FRAME_HEIGHT;
          const xOff = idx * (frameW + FRAME_GAP);
          const frameLeft = canvasRect.left + canvasX + xOff * zoom;
          const frameTop = canvasRect.top + canvasY;
          const frameRight = frameLeft + frameW * zoom;
          const frameBottom = frameTop + fH * zoom;
          if (mouseX >= frameLeft && mouseX <= frameRight && mouseY >= frameTop && mouseY <= frameBottom && p.slug !== prev.sourceSlug) {
            // Create proto link
            setProtoLinks(links => [...links, {
              id: `pl-${Date.now()}`,
              sourceSlug: prev.sourceSlug,
              sourcePath: prev.sourcePath,
              targetSlug: p.slug,
              sourceRect: prev.sourceRect,
            }]);
            break;
          }
        }
        return null;
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [tool, pages, device, frameHeights, canvasX, canvasY, zoom]);

  // Center canvas & auto-fit zoom so ALL frames are visible (Figma-style)
  const initialFitDone = useRef(false);
  useEffect(() => {
    if (!loading && pages.length > 0 && canvasRef.current) {
      const frameW = DEVICE_WIDTHS[device];
      const gap = FRAME_GAP;
      const canvasRect = canvasRef.current.getBoundingClientRect();
      // Use real heights — find the tallest frame
      const maxH = Math.max(...pages.map(p => frameHeights[p.slug] || FRAME_HEIGHT));
      // Total layout: frames side by side horizontally
      const totalW = pages.length * frameW + (pages.length - 1) * gap;
      const totalH = maxH + 40; // +40 for label above
      const padding = 80; // px padding around the layout
      const availW = canvasRect.width - padding * 2;
      const availH = canvasRect.height - padding * 2;
      const fitZoom = Math.min(availW / totalW, availH / totalH, 1);
      // Only auto-fit on initial load or when heights first arrive
      if (!initialFitDone.current || Object.keys(frameHeights).length === pages.length) {
        setZoom(fitZoom);
        setCanvasX((canvasRect.width - totalW * fitZoom) / 2);
        setCanvasY((canvasRect.height - totalH * fitZoom) / 2 + 30 * fitZoom);
        if (Object.keys(frameHeights).length >= pages.length) initialFitDone.current = true;
      }
    }
  }, [loading, pages.length, device, frameHeights]);

  // Close add menu on click outside
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuOpen]);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: FG.bg, color: FG.text }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: `2px solid ${FG.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 13, color: FG.textDim }}>Loading editor...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: FG.bg, fontFamily: 'Inter, system-ui, -apple-system, sans-serif', color: FG.text }}>
      {/* Clip notification */}
      {clipNotif && (
        <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 999,
          background: FG.accent, color: '#1A1A1A', padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500 }}>
          {clipNotif}
        </div>
      )}

      {/* ─── TOP BAR (Figma style) ─── */}
      <div style={{ height: 48, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8,
        background: FG.panel, borderBottom: `1px solid ${FG.border}`, flexShrink: 0, zIndex: 10 }}>
        {/* Logo / Back */}
        <button onClick={() => navigate(`/company/${id}`)} style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', color: FG.textDim, cursor: 'pointer', padding: '6px 8px', borderRadius: 6, fontSize: 12 }}
          onMouseEnter={e => (e.currentTarget.style.background = FG.panelHover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>

        <div style={{ width: 1, height: 24, background: FG.border }} />

        {/* Project name */}
        <span style={{ color: FG.text, fontSize: 13, fontWeight: 600, padding: '4px 8px' }}>
          {pages.find(p => p.slug === activeSlug)?.title || activeSlug}
        </span>

        <div style={{ flex: 1 }} />

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} style={{ ...tbtn(), fontSize: 14, width: 24, height: 24 }}>−</button>
          <span style={{ color: FG.textDim, fontSize: 11, minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} style={{ ...tbtn(), fontSize: 14, width: 24, height: 24 }}>+</button>
        </div>

        <div style={{ width: 1, height: 24, background: FG.border }} />

        {/* Device */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 6, background: FG.surface }}>
          {(['desktop', 'tablet', 'mobile'] as DeviceMode[]).map(m => (
            <button key={m} onClick={() => setDevice(m)} title={m}
              style={{ padding: 4, borderRadius: 4, border: 'none', cursor: 'pointer',
                background: device === m ? FG.accent : 'transparent', color: device === m ? '#1A1A1A' : FG.textDim }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d={m === 'desktop' ? 'M4 6h16v12H4z' : m === 'tablet' ? 'M6 3h12v18H6zM9 19h6' : 'M8 2h8v20H8zM10 18h4'} />
              </svg>
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: FG.border }} />

        {/* Undo/Redo */}
        <button onClick={undo} disabled={!canUndo} style={{ ...tbtn(), opacity: canUndo ? 1 : 0.3 }} title="Undo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10h10a5 5 0 015 5 5 5 0 01-5 5H8M3 10l4-4M3 10l4 4"/></svg>
        </button>
        <button onClick={redo} disabled={!canRedo} style={{ ...tbtn(), opacity: canRedo ? 1 : 0.3 }} title="Redo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10H11a5 5 0 00-5 5 5 5 0 005 5h5M21 10l-4-4M21 10l-4 4"/></svg>
        </button>

        <div style={{ width: 1, height: 24, background: FG.border }} />

        {/* Dirty indicator */}
        {dirtyCount > 0 && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,205,41,0.15)', color: FG.orange }}>
            {dirtyCount} unsaved
          </span>
        )}

        {/* Multi-select badge */}
        {multiCount > 1 && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: FG.accentBg, color: FG.accent, fontWeight: 600 }}>
            {multiCount} selected
          </span>
        )}

        {/* Selected element actions */}
        {selected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 4, background: FG.surface, color: FG.textDim }}>
              {selected.tagName}
            </span>
            {[
              { t: 'Move up', icon: 'M12 19V5M5 12l7-7 7 7', action: () => sendToActive({ type: 'move-element', data: { direction: 'up' } }) },
              { t: 'Move down', icon: 'M12 5v14M19 12l-7 7-7-7', action: () => sendToActive({ type: 'move-element', data: { direction: 'down' } }) },
              { t: 'Copy', icon: 'M8 8h8v8H8zM16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2', action: () => sendToActive({ type: 'copy-element' }) },
              { t: 'Duplicate', icon: 'M8 8h8v8H8zM16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2M12 10v4M14 12h-4', action: () => sendToActive({ type: 'duplicate-element' }) },
            ].map((b, i) => (
              <button key={i} onClick={b.action} title={b.t} style={tbtn()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={b.icon}/></svg>
              </button>
            ))}
            <button onClick={() => sendToActive({ type: 'delete-element' })} title="Delete" style={{ ...tbtn(), color: FG.red }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        )}

        {/* Save */}
        <button onClick={saveAll} disabled={saving || dirtyCount === 0}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 8,
            border: 'none', cursor: dirtyCount > 0 ? 'pointer' : 'default', fontSize: 12, fontWeight: 600,
            background: dirtyCount > 0 ? FG.accent : FG.surface, color: dirtyCount > 0 ? '#1A1A1A' : FG.textMuted,
            opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>

        {/* Publish — ouvre la popup "Publish your website" */}
        <button ref={publishBtnRef} onClick={() => setPublishOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 18px', borderRadius: 8,
            border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
            background: '#fff', color: '#111' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          Publish
        </button>
      </div>
      {publishOpen && <PublishModal companyId={id} onClose={() => setPublishOpen(false)} anchorRef={publishBtnRef} />}

      {/* ─── MAIN AREA ─── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* ─── LEFT PANEL (Layers + Pages) ─── */}
        {leftOpen && (
          <div style={{ width: 240, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${FG.border}`,
            background: FG.panel, flexShrink: 0, overflow: 'hidden' }}>
            {/* Pages list */}
            <div style={{ borderBottom: `1px solid ${FG.border}`, padding: '6px 0' }}>
              <div style={{ padding: '4px 12px 4px', fontSize: 10, color: FG.textMuted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Pages</div>
              {pages.map(p => (
                <button key={p.slug} onClick={() => {
                  setActiveSlug(p.slug); setSelected(null);
                  sendToFrame(p.slug, { type: 'get-layers' });
                  // Center canvas on this frame
                  if (canvasRef.current) {
                    const frameW = DEVICE_WIDTHS[device];
                    const fH = frameHeights[p.slug] || FRAME_HEIGHT;
                    const gap = FRAME_GAP;
                    const pidx = pages.findIndex(pp => pp.slug === p.slug);
                    const targetX = pidx * (frameW + gap);
                    const canvasRect = canvasRef.current.getBoundingClientRect();
                    setCanvasX(canvasRect.width / 2 - (targetX + frameW / 2) * zoom);
                    setCanvasY(canvasRect.height / 2 - (fH / 2) * zoom);
                  }
                }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 12px', border: 'none', cursor: 'pointer',
                    background: activeSlug === p.slug ? FG.accentBg : 'none', color: activeSlug === p.slug ? FG.accent : FG.textDim,
                    fontSize: 11, textAlign: 'left', fontWeight: activeSlug === p.slug ? 600 : 400 }}
                  onMouseEnter={e => { if (activeSlug !== p.slug) e.currentTarget.style.background = FG.panelHover; }}
                  onMouseLeave={e => { if (activeSlug !== p.slug) e.currentTarget.style.background = 'none'; }}>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>
                  {p.title || p.slug}
                  {dirtySetRef.current.has(p.slug) && <span style={{ fontSize: 9, color: FG.orange, marginLeft: 'auto' }}>●</span>}
                </button>
              ))}
            </div>

            {/* Layers */}
            <div style={{ padding: '4px 12px 4px', fontSize: 10, color: FG.textMuted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, borderBottom: `1px solid ${FG.border}`, paddingTop: 8, paddingBottom: 6 }}>
              Layers — {pages.find(p => p.slug === activeSlug)?.title || activeSlug}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              <LayerTree layers={layers} sendToActive={sendToActive} selected={selected} />
            </div>
          </div>
        )}

        {/* ─── CANVAS (infinite, pannable, zoomable) ─── */}
        <div ref={canvasRef} style={{ flex: 1, position: 'relative', overflow: 'hidden',
          background: FG.bg, cursor: tool === 'hand' ? 'grab' : tool === 'frame' ? 'crosshair' : tool === 'proto' ? 'crosshair' : 'default',
          backgroundImage: `radial-gradient(circle, ${FG.border}40 1px, transparent 1px)`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${canvasX}px ${canvasY}px`,
        }}>
          {/* All page frames laid out horizontally (Figma-style) */}
          {pages.map((p, idx) => {
            const frameW = DEVICE_WIDTHS[device];
            const frameH = frameHeights[p.slug] || FRAME_HEIGHT;
            const gap = FRAME_GAP;
            const xOffset = idx * (frameW + gap);
            const isActiveFrame = activeSlug === p.slug;
            return (
              <div key={p.slug}>
                {/* Frame label */}
                <div style={{
                  position: 'absolute',
                  left: canvasX + xOffset * zoom,
                  top: canvasY - 28 * zoom,
                  transform: `scale(${zoom})`, transformOrigin: 'bottom left', whiteSpace: 'nowrap',
                  color: isActiveFrame ? FG.text : FG.textDim,
                  fontSize: 12, fontWeight: isActiveFrame ? 600 : 400,
                  cursor: 'pointer',
                  padding: '2px 4px',
                }} onClick={() => { setActiveSlug(p.slug); setSelected(null); sendToFrame(p.slug, { type: 'get-layers' }); }}>
                  {p.title || p.slug}
                </div>

                {/* Frame container */}
                <div style={{
                  position: 'absolute',
                  left: canvasX + xOffset * zoom,
                  top: canvasY,
                  width: frameW,
                  height: frameH,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  borderRadius: device !== 'desktop' ? 24 : 0,
                  overflow: 'hidden',
                  boxShadow: isActiveFrame
                    ? `0 0 0 2px ${FG.accent}, 0 25px 50px -12px rgba(0,0,0,0.5)`
                    : '0 0 0 1px rgba(255,255,255,0.06), 0 25px 50px -12px rgba(0,0,0,0.5)',
                }}>
                  <iframe
                    ref={(el) => setIframeRef(p.slug, el)}
                    scrolling="no"
                    style={{ width: '100%', height: '100%', border: 'none', background: '#fff',
                      pointerEvents: tool === 'hand' ? 'none' : 'auto', overflow: 'hidden' }}
                    sandbox="allow-scripts allow-same-origin"
                    title={`Page: ${p.title || p.slug}`}
                    onLoad={() => {
                      // Fallback in case the in-page script never posts a
                      // content-height message (e.g. empty page) — don't leave
                      // the spinner stuck forever.
                      setTimeout(() => {
                        setReadySlugs(prev => (prev.has(p.slug) ? prev : new Set(prev).add(p.slug)));
                      }, 1000);
                    }}
                  />
                  {!readySlugs.has(p.slug) && (
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#fff', pointerEvents: 'none',
                    }}>
                      <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={FG.accent} strokeWidth="3" strokeLinecap="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Free frames on canvas */}
          {freeFrames.map(ff => (
            <div key={ff.id} style={{
              position: 'absolute',
              left: canvasX + ff.x * zoom,
              top: canvasY + ff.y * zoom,
              width: ff.width * zoom,
              height: ff.height * zoom,
              border: `${2 * zoom}px dashed ${ff.color}`,
              borderRadius: 8 * zoom,
              background: `${ff.color}08`,
              pointerEvents: 'none',
            }}>
              <div style={{ position: 'absolute', top: -22 * zoom, left: 0, fontSize: 11 * zoom, color: ff.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {ff.label}
              </div>
            </div>
          ))}

          {/* Drawing frame rectangle */}
          {drawingFrame && (() => {
            const x = Math.min(drawingFrame.startX, drawingFrame.curX);
            const y = Math.min(drawingFrame.startY, drawingFrame.curY);
            const w = Math.abs(drawingFrame.curX - drawingFrame.startX);
            const h = Math.abs(drawingFrame.curY - drawingFrame.startY);
            return (
              <div style={{
                position: 'absolute', left: x, top: y, width: w, height: h,
                border: `2px dashed ${FG.accent}`, borderRadius: 8,
                background: `${FG.accent}10`, pointerEvents: 'none',
              }} />
            );
          })()}

          {/* Prototype arrows SVG overlay */}
          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
            {protoLinks.map(link => {
              const srcIdx = pages.findIndex(p => p.slug === link.sourceSlug);
              const tgtIdx = pages.findIndex(p => p.slug === link.targetSlug);
              if (srcIdx < 0 || tgtIdx < 0) return null;
              const srcFrameW = DEVICE_WIDTHS[device];
              const srcXOff = srcIdx * (srcFrameW + FRAME_GAP);
              const tgtXOff = tgtIdx * (srcFrameW + FRAME_GAP);
              const tgtH = frameHeights[link.targetSlug] || FRAME_HEIGHT;
              // Source point: right edge of source element
              const sr = link.sourceRect;
              const sx = canvasX + (srcXOff + (sr ? sr.x + sr.w : srcFrameW)) * zoom;
              const sy = canvasY + (sr ? sr.y + sr.h / 2 : 100) * zoom;
              // Target point: left edge of target frame, vertically centered
              const tx = canvasX + tgtXOff * zoom;
              const ty = canvasY + (tgtH / 2) * zoom;
              // Bezier control points
              const cpDist = Math.abs(tx - sx) * 0.5;
              return (
                <g key={link.id}>
                  <path
                    d={`M ${sx} ${sy} C ${sx + cpDist} ${sy}, ${tx - cpDist} ${ty}, ${tx} ${ty}`}
                    fill="none" stroke={FG.accent} strokeWidth={2} strokeDasharray="6 3" opacity={0.7}
                  />
                  <circle cx={sx} cy={sy} r={5 * zoom} fill={FG.accent} opacity={0.8} />
                  {/* Arrow head */}
                  <polygon
                    points={`${tx},${ty} ${tx - 8 * zoom},${ty - 5 * zoom} ${tx - 8 * zoom},${ty + 5 * zoom}`}
                    fill={FG.accent} opacity={0.8}
                  />
                </g>
              );
            })}
            {/* Prototype drag line */}
            {protoDragging && (() => {
              const srcIdx = pages.findIndex(p => p.slug === protoDragging.sourceSlug);
              if (srcIdx < 0) return null;
              const srcFrameW = DEVICE_WIDTHS[device];
              const srcXOff = srcIdx * (srcFrameW + FRAME_GAP);
              const sr = protoDragging.sourceRect;
              const sx = canvasX + (srcXOff + sr.x + sr.w) * zoom;
              const sy = canvasY + (sr.y + sr.h / 2) * zoom;
              const mx = protoDragging.mouseX;
              const my = protoDragging.mouseY;
              const cpDist = Math.abs(mx - sx) * 0.4;
              return (
                <path
                  d={`M ${sx} ${sy} C ${sx + cpDist} ${sy}, ${mx - cpDist} ${my}, ${mx} ${my}`}
                  fill="none" stroke={FG.accent} strokeWidth={2} opacity={0.6}
                />
              );
            })()}
          </svg>

          {/* Cross-drag ghost element */}
          {crossDrag && (
            <div style={{
              position: 'fixed',
              left: crossDrag.ghostX - crossDrag.width / 2,
              top: crossDrag.ghostY - crossDrag.height / 2,
              width: crossDrag.width,
              height: crossDrag.height,
              background: FG.accentBg,
              border: `2px solid ${FG.accent}`,
              borderRadius: 8,
              opacity: 0.7,
              pointerEvents: 'none',
              zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: FG.accent, fontWeight: 600,
            }}>
              Drop on another frame
            </div>
          )}

          {/* Zoom indicator */}
          <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', alignItems: 'center', gap: 4,
            background: FG.panel, borderRadius: 6, padding: '4px 8px', border: `1px solid ${FG.border}` }}>
            <span style={{ color: FG.textDim, fontSize: 11 }}>{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        {/* ─── RIGHT PANEL (Figma Design panel) ─── */}
        {rightOpen && (
          <RightPanel selected={selected} multiCount={multiCount} applyStyle={applyStyle}
            applyStyleDebounced={applyStyleDebounced} sendToActive={sendToActive} />
        )}
      </div>

      {/* ─── BOTTOM TOOLBAR (Figma floating) ─── */}
      <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 12,
        background: FG.panel, border: `1px solid ${FG.border}`, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        {/* Tools */}
        {([
          { id: 'move', key: 'V', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 8-6 2-2 6z"/></svg> },
          { id: 'hand', key: 'H', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 11V6a2 2 0 00-4 0M14 10V4a2 2 0 00-4 0v7M10 10.5V6a2 2 0 00-4 0v8M18 11a2 2 0 014 0v3a8 8 0 01-8 8h-2a8 8 0 01-6-3l-3.36-4.48a2 2 0 013.24-2.35L6 13"/></svg> },
          { id: 'frame', key: 'F', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg> },
          { id: 'text', key: 'T', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg> },
          { id: 'proto', key: 'P', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="12" r="3"/><path d="M8 12h8" strokeDasharray="3 2"/><path d="M14 9l3 3-3 3"/></svg> },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTool(t.id as Tool)} title={`${t.id} (${t.key})`}
            style={{ padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: tool === t.id ? FG.accent : 'transparent', color: tool === t.id ? '#1A1A1A' : FG.textDim }}
            onMouseEnter={e => { if (tool !== t.id) e.currentTarget.style.background = FG.panelHover; }}
            onMouseLeave={e => { if (tool !== t.id) e.currentTarget.style.background = tool === t.id ? FG.accent : 'transparent'; }}>
            {t.icon}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: FG.border, margin: '0 4px' }} />

        {/* Add Element */}
        <div ref={addMenuRef} style={{ position: 'relative' }}>
          <button onClick={() => setAddMenuOpen(v => !v)} title="Add element"
            style={{ padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              background: addMenuOpen ? FG.accent : 'transparent', color: addMenuOpen ? '#1A1A1A' : FG.textDim, fontSize: 11, fontWeight: 500 }}
            onMouseEnter={e => { if (!addMenuOpen) e.currentTarget.style.background = FG.panelHover; }}
            onMouseLeave={e => { if (!addMenuOpen) e.currentTarget.style.background = 'transparent'; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add
          </button>
          {addMenuOpen && (
            <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
              marginBottom: 8, background: FG.panel, border: `1px solid ${FG.border}`, borderRadius: 10,
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: 6, minWidth: 200, zIndex: 200 }}>
              <div style={{ padding: '4px 10px', fontSize: 10, color: FG.textMuted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Layout</div>
              {([
                { kind: 'div', label: 'Section', icon: '▢' },
                { kind: 'columns', label: '2 Columns', icon: '▥', cols: 2 },
                { kind: 'columns', label: '3 Columns', icon: '▦', cols: 3 },
                { kind: 'spacer', label: 'Spacer', icon: '↕' },
                { kind: 'hr', label: 'Divider', icon: '―' },
              ] as const).map((item, i) => (
                <button key={`layout-${i}`} onClick={() => {
                  sendToActive({ type: 'add-element', data: { kind: item.kind, ...(('cols' in item) ? { cols: item.cols } : {}) } });
                  setAddMenuOpen(false); markDirty();
                }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: 'none', borderRadius: 6,
                  background: 'transparent', color: FG.text, cursor: 'pointer', fontSize: 12, textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = FG.panelHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ width: 20, textAlign: 'center', fontSize: 14, opacity: 0.6 }}>{item.icon}</span>{item.label}
                </button>
              ))}
              <div style={{ height: 1, background: FG.border, margin: '4px 0' }} />
              <div style={{ padding: '4px 10px', fontSize: 10, color: FG.textMuted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Content</div>
              {([
                { kind: 'heading', label: 'Heading', icon: 'H' },
                { kind: 'text', label: 'Text', icon: 'T' },
                { kind: 'image', label: 'Image', icon: '🖼' },
                { kind: 'button', label: 'Button', icon: '▣' },
                { kind: 'link', label: 'Link', icon: '🔗' },
                { kind: 'list', label: 'List', icon: '☰' },
                { kind: 'video', label: 'Video', icon: '▶' },
                { kind: 'form', label: 'Form', icon: '📝' },
              ] as const).map((item, i) => (
                <button key={`content-${i}`} onClick={() => {
                  sendToActive({ type: 'add-element', data: { kind: item.kind } });
                  setAddMenuOpen(false); markDirty();
                }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: 'none', borderRadius: 6,
                  background: 'transparent', color: FG.text, cursor: 'pointer', fontSize: 12, textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = FG.panelHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ width: 20, textAlign: 'center', fontSize: 14, opacity: 0.6 }}>{item.icon}</span>{item.label}
                </button>
              ))}
              <div style={{ height: 1, background: FG.border, margin: '4px 0' }} />
              <div style={{ padding: '4px 10px', fontSize: 10, color: FG.textMuted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Insert position</div>
              <div style={{ display: 'flex', gap: 4, padding: '4px 10px 6px' }}>
                <span style={{ fontSize: 10, color: selected ? FG.text : FG.textMuted }}>
                  {selected ? 'After selected element' : 'At end of page body'}
                </span>
              </div>
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: FG.border, margin: '0 4px' }} />

        {/* Panel toggles */}
        <button onClick={() => setLeftOpen(v => !v)} style={{ ...tbtn(), color: leftOpen ? FG.accent : FG.textDim }} title="Toggle layers">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
        </button>
        <button onClick={() => setRightOpen(v => !v)} style={{ ...tbtn(), color: rightOpen ? FG.accent : FG.textDim }} title="Toggle design panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg>
        </button>

        <div style={{ width: 1, height: 20, background: FG.border, margin: '0 4px' }} />

        {/* Keyboard shortcuts hint */}
        <div style={{ display: 'flex', gap: 6, padding: '0 4px' }}>
          {[['⌘S', 'Save'], ['⌘Z', 'Undo'], ['⌘C', 'Copy'], ['⌘V', 'Paste'], ['⌘D', 'Dup'], ['Del', 'Delete'], ['Shift+Click', 'Multi']].map(([k, l]) => (
            <span key={k} style={{ fontSize: 9, color: FG.textMuted }} title={l}>
              <kbd style={{ padding: '1px 3px', borderRadius: 2, background: FG.surface, fontSize: 8, fontFamily: 'inherit' }}>{k}</kbd>
            </span>
          ))}
        </div>
      </div>

      {/* Global CSS for spinner animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } select option { background: ${FG.panel}; color: ${FG.text}; }`}</style>
    </div>
  );
}

// ─── LAYER TREE (recursive Figma-style) ──────────────────────────────────────
function LayerTree({ layers, sendToActive, selected, depth = 0 }: any) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <>
      {(layers || []).map((l: any, i: number) => {
        const isSelected = selected?.tagPath === l.path;
        const hasKids = l.children && l.children.length > 0;
        const isCollapsed = collapsed.has(l.path);
        return (
          <div key={l.path + i}>
            <div
              onClick={() => sendToActive({ type: 'select-by-path', data: { path: l.path } })}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', paddingLeft: 8 + (depth || l.depth || 0) * 16,
                cursor: 'pointer', fontSize: 11, color: isSelected ? FG.accent : FG.textDim,
                background: isSelected ? FG.accentBg : 'transparent', borderLeft: isSelected ? `2px solid ${FG.accent}` : '2px solid transparent' }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = FG.panelHover; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
              {hasKids ? (
                <button onClick={(e) => { e.stopPropagation(); setCollapsed(prev => { const n = new Set(prev); n.has(l.path) ? n.delete(l.path) : n.add(l.path); return n; }); }}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: FG.textMuted, display: 'flex', width: 12, flexShrink: 0 }}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.1s' }}>
                    <path d="M2 1l4 3-4 3z"/>
                  </svg>
                </button>
              ) : <span style={{ width: 12, flexShrink: 0 }} />}
              <TagIcon tag={l.tag} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {l.id ? `#${l.id}` : l.cls ? `.${l.cls}` : l.text || l.tag}
              </span>
            </div>
            {hasKids && !isCollapsed && (
              <LayerTree layers={l.children} sendToActive={sendToActive} selected={selected} depth={(depth || l.depth || 0) + 1} />
            )}
          </div>
        );
      })}
    </>
  );
}

// ─── RIGHT PANEL (Figma Design panel) ────────────────────────────────────────
const RightPanel = memo(function RightPanel({ selected, multiCount, applyStyle, applyStyleDebounced, sendToActive }: any) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['position', 'typography', 'fill', 'stroke']));
  const toggle = (k: string) => setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (!selected) {
    return (
      <div style={{ width: 256, borderLeft: `1px solid ${FG.border}`, background: FG.panel, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: 20 }}>
          {multiCount > 1 ? (
            <>
              <div style={{ width: 40, height: 40, borderRadius: 20, background: FG.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                <span style={{ color: FG.accent, fontWeight: 700, fontSize: 16 }}>{multiCount}</span>
              </div>
              <p style={{ fontSize: 12, color: FG.textDim }}>{multiCount} elements selected</p>
              <p style={{ fontSize: 10, color: FG.textMuted, marginTop: 4 }}>Shift+Click to toggle</p>
            </>
          ) : (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={FG.textMuted} strokeWidth="1" style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }}>
                <path d="M5 3l14 8-6 2-2 6z"/>
              </svg>
              <p style={{ fontSize: 12, color: FG.textMuted }}>Select an element</p>
              <p style={{ fontSize: 10, color: FG.textMuted, marginTop: 2 }}>Click to select, double-click to edit text</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const s = selected.styles || {};
  const get = (k: string) => s[camelToKebab(k)] || s[k] || '';

  return (
    <div style={{ width: 256, borderLeft: `1px solid ${FG.border}`, background: FG.panel, flexShrink: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 12px 8px', borderBottom: `1px solid ${FG.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ background: FG.accent, color: '#fff', fontFamily: 'monospace', fontSize: 11, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
            {selected.tagName}
          </span>
          {selected.attributes?.id && <span style={{ fontFamily: 'monospace', fontSize: 10, color: FG.textDim }}>#{selected.attributes.id}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 10, color: FG.textMuted, background: FG.surface, padding: '2px 6px', borderRadius: 3 }}>
            {Math.round(selected.rect.width)} × {Math.round(selected.rect.height)}
          </span>
          <span style={{ fontSize: 10, color: FG.textMuted, background: FG.surface, padding: '2px 6px', borderRadius: 3 }}>
            ({Math.round(selected.rect.x)}, {Math.round(selected.rect.y)})
          </span>
        </div>
      </div>

      {/* Design tab label */}
      <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, color: FG.text, borderBottom: `1px solid ${FG.border}` }}>Design</div>

      {/* ─── Position ─── */}
      <PanelSection title="Position" expanded={expanded.has('position')} toggle={() => toggle('position')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <FInput label="X" value={get('left')} onChange={v => applyStyle('left', v)} />
          <FInput label="Y" value={get('top')} onChange={v => applyStyle('top', v)} />
          <FInput label="W" value={get('width')} onChange={v => applyStyle('width', v)} />
          <FInput label="H" value={get('height')} onChange={v => applyStyle('height', v)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
          <div className="flex items-center gap-1">
            <span style={{ color: FG.textDim, fontSize: 10, width: 14, textAlign: 'center' }}>↻</span>
            <select value={get('position')} onChange={e => applyStyle('position', e.target.value)}
              style={{ background: FG.surface, color: FG.text, border: 'none', borderRadius: 4, fontSize: 11, padding: '4px 6px', width: '100%', outline: 'none' }}>
              <option value="">--</option>
              {['static', 'relative', 'absolute', 'fixed', 'sticky'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <FInput label="Z" value={get('zIndex')} onChange={v => applyStyle('zIndex', v)} />
        </div>
      </PanelSection>

      {/* ─── Layout ─── */}
      <PanelSection title="Layout" expanded={expanded.has('layout')} toggle={() => toggle('layout')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div className="flex items-center gap-1">
            <span style={{ color: FG.textDim, fontSize: 9, width: 10 }}>⊞</span>
            <select value={get('display')} onChange={e => applyStyle('display', e.target.value)}
              style={{ ...selStyle(), width: '100%' }}>
              <option value="">--</option>
              {['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span style={{ color: FG.textDim, fontSize: 9, width: 10 }}>↔</span>
            <select value={get('flexDirection')} onChange={e => applyStyle('flexDirection', e.target.value)}
              style={{ ...selStyle(), width: '100%' }}>
              <option value="">--</option>
              {['row', 'column', 'row-reverse', 'column-reverse'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
          {[
            { l: '⇔', k: 'justifyContent', opts: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] },
            { l: '⇕', k: 'alignItems', opts: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'] },
            { l: '↩', k: 'flexWrap', opts: ['nowrap', 'wrap', 'wrap-reverse'] },
          ].map(({ l, k, opts }) => (
            <div key={k} className="flex items-center gap-1">
              <span style={{ color: FG.textDim, fontSize: 9, width: 10 }}>{l}</span>
              <select value={get(k)} onChange={e => applyStyle(k, e.target.value)} style={{ ...selStyle(), width: '100%' }}>
                <option value="">--</option>
                {opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
          <FInput label="⊡" value={get('gap')} onChange={v => applyStyle('gap', v)} />
        </div>
      </PanelSection>

      {/* ─── Spacing ─── */}
      <PanelSection title="Spacing" expanded={expanded.has('spacing')} toggle={() => toggle('spacing')}>
        {/* Visual box model */}
        <div style={{ position: 'relative', background: FG.surface, borderRadius: 6, padding: 4, marginBottom: 4 }}>
          <div style={{ fontSize: 8, color: FG.textMuted, marginBottom: 2, textAlign: 'center' }}>margin</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 2, marginBottom: 2 }}>
            <FInput label="↑" value={get('marginTop')} onChange={v => applyStyle('marginTop', v)} />
            <FInput label="→" value={get('marginRight')} onChange={v => applyStyle('marginRight', v)} />
            <FInput label="↓" value={get('marginBottom')} onChange={v => applyStyle('marginBottom', v)} />
            <FInput label="←" value={get('marginLeft')} onChange={v => applyStyle('marginLeft', v)} />
          </div>
          <div style={{ fontSize: 8, color: FG.textMuted, marginBottom: 2, textAlign: 'center' }}>padding</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 2 }}>
            <FInput label="↑" value={get('paddingTop')} onChange={v => applyStyle('paddingTop', v)} />
            <FInput label="→" value={get('paddingRight')} onChange={v => applyStyle('paddingRight', v)} />
            <FInput label="↓" value={get('paddingBottom')} onChange={v => applyStyle('paddingBottom', v)} />
            <FInput label="←" value={get('paddingLeft')} onChange={v => applyStyle('paddingLeft', v)} />
          </div>
        </div>
      </PanelSection>

      {/* ─── Size ─── */}
      <PanelSection title="Size" expanded={expanded.has('size')} toggle={() => toggle('size')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <FInput label="W" value={get('width')} onChange={v => applyStyle('width', v)} />
          <FInput label="H" value={get('height')} onChange={v => applyStyle('height', v)} />
          <FInput label="Mn" value={get('minWidth')} onChange={v => applyStyle('minWidth', v)} />
          <FInput label="Mx" value={get('maxWidth')} onChange={v => applyStyle('maxWidth', v)} />
          <FInput label="Mn" value={get('minHeight')} onChange={v => applyStyle('minHeight', v)} />
          <FInput label="Mx" value={get('maxHeight')} onChange={v => applyStyle('maxHeight', v)} />
        </div>
      </PanelSection>

      {/* ─── Typography ─── */}
      <PanelSection title="Typography" expanded={expanded.has('typography')} toggle={() => toggle('typography')}>
        <FInput label="Aa" value={get('fontFamily')} onChange={v => applyStyle('fontFamily', v)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
          <FInput label="Sz" value={get('fontSize')} onChange={v => applyStyle('fontSize', v)} />
          <div className="flex items-center gap-1">
            <span style={{ color: FG.textDim, fontSize: 10, width: 14, textAlign: 'center' }}>W</span>
            <select value={get('fontWeight')} onChange={e => applyStyle('fontWeight', e.target.value)} style={{ ...selStyle(), width: '100%' }}>
              <option value="">--</option>
              {['100', '200', '300', '400', '500', '600', '700', '800', '900'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <FInput label="Lh" value={get('lineHeight')} onChange={v => applyStyle('lineHeight', v)} />
          <FInput label="Ls" value={get('letterSpacing')} onChange={v => applyStyle('letterSpacing', v)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
          {[
            { l: '≡', k: 'textAlign', opts: ['left', 'center', 'right', 'justify'] },
            { l: 'Tt', k: 'textTransform', opts: ['none', 'uppercase', 'lowercase', 'capitalize'] },
            { l: 'U̲', k: 'textDecoration', opts: ['none', 'underline', 'line-through'] },
          ].map(({ l, k, opts }) => (
            <div key={k} className="flex items-center gap-1">
              <span style={{ color: FG.textDim, fontSize: 10, width: 14, textAlign: 'center' }}>{l}</span>
              <select value={get(k)} onChange={e => applyStyle(k, e.target.value)} style={{ ...selStyle(), width: '100%' }}>
                <option value="">--</option>
                {opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
        {/* Text color */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <input type="color" value={toHex(get('color'))} onChange={e => applyStyleDebounced('color', e.target.value)}
            style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none' }} />
          <span style={{ fontSize: 10, color: FG.textDim }}>Color</span>
          <span style={{ fontSize: 10, color: FG.text, fontFamily: 'monospace', marginLeft: 'auto' }}>{toHex(get('color'))}</span>
        </div>
      </PanelSection>

      {/* ─── Fill ─── */}
      <PanelSection title="Fill" expanded={expanded.has('fill')} toggle={() => toggle('fill')} hasAdd>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="color" value={toHex(get('backgroundColor'))} onChange={e => applyStyleDebounced('backgroundColor', e.target.value)}
            style={{ width: 24, height: 24, border: `1px solid ${FG.border}`, borderRadius: 4, cursor: 'pointer', background: 'none' }} />
          <FInput label="" value={get('backgroundColor')} onChange={v => applyStyle('backgroundColor', v)} />
          <FInput label="%" value={get('opacity')} onChange={v => applyStyle('opacity', v)} />
        </div>
        <div style={{ marginTop: 4 }}>
          <FInput label="🖼" value={get('backgroundImage')} onChange={v => applyStyle('backgroundImage', v)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
          <div className="flex items-center gap-1">
            <span style={{ color: FG.textDim, fontSize: 9, width: 10 }}>⬒</span>
            <select value={get('backgroundSize')} onChange={e => applyStyle('backgroundSize', e.target.value)} style={{ ...selStyle(), width: '100%' }}>
              <option value="">--</option>
              {['cover', 'contain', 'auto', '100%'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span style={{ color: FG.textDim, fontSize: 9, width: 10 }}>⟲</span>
            <select value={get('backgroundRepeat')} onChange={e => applyStyle('backgroundRepeat', e.target.value)} style={{ ...selStyle(), width: '100%' }}>
              <option value="">--</option>
              {['no-repeat', 'repeat', 'repeat-x', 'repeat-y'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
      </PanelSection>

      {/* ─── Stroke (Border) ─── */}
      <PanelSection title="Stroke" expanded={expanded.has('stroke')} toggle={() => toggle('stroke')} hasAdd>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="color" value={toHex(get('borderColor'))} onChange={e => applyStyleDebounced('borderColor', e.target.value)}
            style={{ width: 24, height: 24, border: `1px solid ${FG.border}`, borderRadius: 4, cursor: 'pointer', background: 'none' }} />
          <FInput label="" value={get('borderColor')} onChange={v => applyStyle('borderColor', v)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
          <FInput label="W" value={get('borderWidth')} onChange={v => applyStyle('borderWidth', v)} />
          <div className="flex items-center gap-1">
            <span style={{ color: FG.textDim, fontSize: 9, width: 10 }}>─</span>
            <select value={get('borderStyle')} onChange={e => applyStyle('borderStyle', e.target.value)} style={{ ...selStyle(), width: '100%' }}>
              <option value="">--</option>
              {['none', 'solid', 'dashed', 'dotted', 'double'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <FInput label="R" value={get('borderRadius')} onChange={v => applyStyle('borderRadius', v)} />
        </div>
      </PanelSection>

      {/* ─── Effects ─── */}
      <PanelSection title="Effects" expanded={expanded.has('effects')} toggle={() => toggle('effects')} hasAdd>
        <EffectSelect label="Box Shadow" propKey="boxShadow" value={get('boxShadow')} applyStyle={applyStyle} />
        <EffectSelect label="Text Shadow" propKey="textShadow" value={get('textShadow')} applyStyle={applyStyle} />
        <EffectSelect label="Filter" propKey="filter" value={get('filter')} applyStyle={applyStyle} />
        <EffectSelect label="Backdrop" propKey="backdropFilter" value={get('backdropFilter')} applyStyle={applyStyle} />
        <EffectSelect label="Transform" propKey="transform" value={get('transform')} applyStyle={applyStyle} />
        <EffectSelect label="Transition" propKey="transition" value={get('transition')} applyStyle={applyStyle} />
        <div className="flex items-center gap-1" style={{ marginTop: 4 }}>
          <span style={{ color: FG.textDim, fontSize: 10, width: 50 }}>Overflow</span>
          <select value={get('overflow')} onChange={e => applyStyle('overflow', e.target.value)} style={{ ...selStyle(), flex: 1 }}>
            <option value="">--</option>
            {['visible', 'hidden', 'scroll', 'auto'].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </PanelSection>

      {/* ─── Attributes ─── */}
      {(selected.tagName === 'img' || selected.tagName === 'a' || selected.tagName === 'video') && (
        <PanelSection title="Attributes" expanded={expanded.has('attrs')} toggle={() => toggle('attrs')}>
          {selected.tagName === 'img' && (
            <>
              <FInput label="src" value={selected.attributes?.src || ''} onChange={v => sendToActive({ type: 'update-attribute', data: { name: 'src', value: v } })} />
              <div style={{ marginTop: 4 }}><FInput label="alt" value={selected.attributes?.alt || ''} onChange={v => sendToActive({ type: 'update-attribute', data: { name: 'alt', value: v } })} /></div>
            </>
          )}
          {selected.tagName === 'a' && (
            <FInput label="href" value={selected.attributes?.href || ''} onChange={v => sendToActive({ type: 'update-attribute', data: { name: 'href', value: v } })} />
          )}
        </PanelSection>
      )}
    </div>
  );
});

// ─── PANEL SECTION (Figma collapsible) ───────────────────────────────────────
function PanelSection({ title, expanded, toggle, children, hasAdd }: { title: string; expanded: boolean; toggle: () => void; children: any; hasAdd?: boolean }) {
  return (
    <div style={{ borderBottom: `1px solid ${FG.border}` }}>
      <button onClick={toggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        padding: '8px 12px', border: 'none', cursor: 'pointer', background: 'none', color: FG.text, fontSize: 11, fontWeight: 500 }}>
        <span>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {hasAdd && <span style={{ color: FG.textMuted, fontSize: 14, lineHeight: 1 }}>+</span>}
          <svg width="8" height="8" viewBox="0 0 8 8" fill={FG.textMuted}
            style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
            <path d="M1 2l3 3 3-3z"/>
          </svg>
        </div>
      </button>
      {expanded && <div style={{ padding: '0 12px 8px' }}>{children}</div>}
    </div>
  );
}

// ─── STYLE HELPERS ───────────────────────────────────────────────────────────
function tbtn(): React.CSSProperties {
  return { background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: FG.textDim, display: 'flex', alignItems: 'center', justifyContent: 'center' };
}
function selStyle(): React.CSSProperties {
  return { background: FG.surface, color: FG.text, border: 'none', borderRadius: 4, fontSize: 11, padding: '4px 6px', outline: 'none' };
}
