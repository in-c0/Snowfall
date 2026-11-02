(async()=>{
  const I=SF.input, P=SF.player, E=SF.E;
  const log=[];
  I.keys.add('KeyW');
  for (let i=0;i<120;i++){ await SF.sim(0.5); if (E.ui.choiceOpen){ log.push('choice@'+E.time.toFixed(1)+' moved '+P.moved.toFixed(1)); E.ui.pickChoice(0); } if (E.post.fx.fade>0.9) break; if (window.__stop && window.__stop()) break; }
  log.push('t='+E.time.toFixed(1)+' moved='+P.moved.toFixed(1)+' fogD='+E.scene.fog.density.toFixed(3));
  return log;
})()
