export function drawCanvas(context, objects, selected = []) {
  context.clearRect(0,0,1200,800); context.fillStyle = "#ffffff"; context.fillRect(0,0,1200,800);
  for (const item of objects) {
    context.save(); context.strokeStyle = item.color; context.fillStyle = item.color; context.lineWidth = 3;
    context.lineCap = "round"; context.lineJoin = "round";
    const {x,y,width:w,height:h}=item;
    if (item.type === "rect") context.strokeRect(x,y,w,h);
    else if (item.type === "ellipse") { context.beginPath(); context.ellipse(x+w/2,y+h/2,Math.abs(w/2),Math.abs(h/2),0,0,Math.PI*2); context.stroke(); }
    else if (item.type === "text") {
      context.font="22px sans-serif"; context.textBaseline="top";
      item.text.split("\n").forEach((line,i)=>context.fillText(line,x,y+i*28));
    } else if (item.type === "pen") {
      context.beginPath(); (item.points||[]).forEach(([px,py],i)=>i?context.lineTo(x+px,y+py):context.moveTo(x+px,y+py)); context.stroke();
    } else {
      context.beginPath(); context.moveTo(x,y); context.lineTo(x+w,y+h);
      if (item.type === "arrow") { const a=Math.atan2(h,w); for(const delta of [-.45,.45]) { context.moveTo(x+w,y+h);context.lineTo(x+w-18*Math.cos(a+delta),y+h-18*Math.sin(a+delta)); } }
      context.stroke();
    }
    if (selected.includes(item.id)) { context.setLineDash([5,4]); context.strokeStyle="#2585f5";context.lineWidth=1;context.strokeRect(x-6,y-6,w+12,h+12); }
    context.restore();
  }
}
export function hitCanvas(item,x,y) {
  return x>=Math.min(item.x,item.x+item.width)-8 && x<=Math.max(item.x,item.x+item.width)+8 && y>=Math.min(item.y,item.y+item.height)-8 && y<=Math.max(item.y,item.y+item.height)+8;
}
