import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, stepRace, stride, changeLane, sampleGhost, parseRecords, RACE_DISTANCE, STEP, DIFFICULTIES } from '../app/race-engine.ts';

test('all skaters and difficulties complete three valid laps', () => {
  for (const character of ['dante', 'nova', 'kai']) for (const difficulty of DIFFICULTIES) {
    const g = createRace(character, { mode: 'race', difficulty: difficulty.id });
    for (let i = 0; i < 15000 && g.finishTime === null; i++) {
      stepRace(g, { skate: true, boost: i % 1000 < 200 });
      assert.ok(Number.isFinite(g.distance) && g.lane >= 0 && g.lane <= 2);
      assert.ok(g.stamina >= 0 && g.stamina <= 100);
    }
    assert.ok(g.finishTime > 15 && g.finishTime < 90);
    assert.equal(g.lapTimes.length, 3);
    assert.equal(g.distance, RACE_DISTANCE);
    assert.ok(Math.abs(g.lapTimes.reduce((a,b) => a+b,0) - g.finishTime) < 1e-8);
    assert.ok(g.position >= 1 && g.position <= 4);
  }
});
test('precision strides beat assisted skating and reject spam', () => {
  const g = createRace('dante', { mode: 'time-trial', difficulty: 'rookie' });
  stride(g, 'A'); const speed = g.speed;
  assert.equal(stride(g, 'D'), 'ignored'); assert.equal(g.speed, speed);
  for (let i = 0; i < 20; i++) { g.elapsed += .38; assert.equal(stride(g, i % 2 ? 'A' : 'D'), 'perfect'); }
  assert.equal(g.bestCombo, 20); assert.ok(g.speed > 13.25);
});
test('boost exhausts, locks, and recovers', () => {
  const g = createRace('kai', { mode: 'time-trial', difficulty: 'rookie' });
  for (let i=0;i<450;i++) stepRace(g,{skate:true,boost:true});
  assert.equal(g.boostLocked,true);
  for (let i=0;i<600;i++) stepRace(g,{skate:true,boost:false});
  assert.equal(g.boostLocked,false); assert.ok(g.stamina>28);
});
test('lane requests clamp and do not teleport the skater', () => {
  const g=createRace(); for(let i=0;i<5;i++) changeLane(g,-1);
  assert.equal(g.targetLane,0); assert.equal(g.lane,1);
  stepRace(g,{skate:false,boost:false}); assert.ok(g.lane>0 && g.lane<1);
  for(let i=0;i<5;i++) changeLane(g,1); assert.equal(g.targetLane,2);
});
test('fixed-step simulations are deterministic and finished races are immutable', () => {
  const a=createRace(),b=createRace();
  for(let i=0;i<6000;i++){ const input={skate:true,boost:i%900<180};stepRace(a,input,STEP);stepRace(b,input,STEP); }
  assert.deepEqual(a,b); const saved=JSON.stringify(a); stepRace(a,{skate:true,boost:true}); assert.equal(JSON.stringify(a),saved);
});
test('ghost interpolation and corrupt saved data are safe', () => {
  assert.equal(sampleGhost([],1),null);
  const samples=[{t:0,distance:0,lane:0,speed:10},{t:10,distance:100,lane:2,speed:12}];
  assert.deepEqual(sampleGhost(samples,5),{t:5,distance:50,lane:1,speed:11});
  assert.deepEqual(parseRecords('broken'),{});
  assert.deepEqual(parseRecords('null'),{});
  const record={time:30,samples};
  assert.deepEqual(parseRecords(JSON.stringify({'time-trial':record}))['time-trial'],record);
  assert.deepEqual(parseRecords(JSON.stringify({'time-trial':{time:30,samples:[{t:0,distance:0,lane:99,speed:10}]}}))['time-trial'].samples,[]);
});
