/* eslint-disable */
import fs from 'fs';
import _ from 'underscore';
import { readFileMap, storeFileMap } from './file';
import getSize from 'get-folder-size';
import {
  fileMapPath,
  activityPatternPath,
  statePath,
  storageDirPath,
  powerStorageSlider,
  maxStorageSlider
} from './ENV_variables';


function readFilesInfo() {
  const fileMap = JSON.parse(fs.readFileSync(fileMapPath));
  const filesInfo = [];
  for(var key in fileMap) {
    if(fileMap.hasOwnProperty(key) && key!='rnd' && key!='stmp' && key!='userID') {
        filesInfo.push({
          id: key,
          name: fileMap[key].name,
          status: 'Ready',
          progressStatus: 100,
          uploadTime: fileMap[key].uploadTime,
          size: fileMap[key].size/1024, // to be CHANGED add size to fileMapEntry in file.js
        });
    }
  }
  return filesInfo;
}

function loadActivityPattern(type) { // asynchronouslly loads the Activity Pattern
  const hourlyPatterns = [];
  const averagePatterns = [];
  const hourlyLabels = [];
  const activityPatternObject = JSON.parse(fs.readFileSync(activityPatternPath));
  const patterns =
        (activityPatternObject.hasOwnProperty("Pattern"))
        ?
        activityPatternObject["Pattern"]
        :
        [];
  let sum = 0;
  for (var i=0; i<patterns.length; i++){
    sum +=parseInt(patterns[i]);
    if(i%6==0){
      hourlyPatterns.push(sum);
      sum = 0;
    }
  }
  if (type=='data'){
    return hourlyPatterns;
  } else if (type=='labels'){
    for (var i=0; i<hourlyPatterns.length; i++){
      hourlyLabels.push('');
    }
    return hourlyLabels;
  } else if (type=='average'){
    for (var i=0; i<hourlyPatterns.length; i++){
      averagePatterns.push(3);
    }
    return averagePatterns;
  }
}

function getStorageSpace(){
  const state = JSON.parse(fs.readFileSync(statePath));
  if(state.hasOwnProperty('storage')) {
    return state.storage;
  } else {
    console.error('Error reading storage field in ' + statePath);
  }
}

function getUsedSpace(){
  let usedSpace = 0;
  fs.readdirSync(storageDirPath).map((fileName)=>{
    if(fs.statSync(storageDirPath+'/'+fileName)){
      usedSpace+=fs.statSync(storageDirPath+'/'+fileName).size;
    }
  })
  return usedSpace/1024/1024;
}

function getStorageInfo(){

  const empty = getStorageSpace() - getUsedSpace();
  const used = getUsedSpace();

  return [empty,used]
}

function transform(value) {
  return Math.round((Math.exp(powerStorageSlider * value / maxStorageSlider) - 1) / (Math.exp(powerStorageSlider) - 1) * maxStorageSlider);
}

function reverse(value) {
  return (1 / powerStorageSlider) * Math.log(((Math.exp(powerStorageSlider) - 1) * value / maxStorageSlider) + 1) * maxStorageSlider;
}

function editStorage(newStorage){
  const state = JSON.parse(fs.readFileSync(statePath));
  state.storage = newStorage;
  fs.writeFileSync(statePath, JSON.stringify(state));
}

function getCredit(){
  const state = JSON.parse(fs.readFileSync(statePath));
  if(state.hasOwnProperty('credit')) {
    return state.credit;
  } else {
    console.error('Error reading storage field in ' + statePath);
  }
}

function editCredit(creditDelta){
  const state = JSON.parse(fs.readFileSync(statePath));
  state.credit = state.credit + creditDelta;
  fs.writeFileSync(statePath, JSON.stringify(state));
}

export {
  getCredit,
  editCredit,
  editStorage,
  reverse,
  transform,
  getStorageInfo,
  getUsedSpace,
  getStorageSpace,
  loadActivityPattern,
  readFilesInfo,
};
