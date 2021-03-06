/* eslint-disable */
import ReedSolomon from 'reed-solomon';
import crypto from 'crypto';
import zlib from 'zlib';
import ObjectID from 'bson-objectid';
import path from 'path';
import async from 'async';
import fs from 'fs';
import request from 'request'
import { storeShredRequest, getShredRequest, saveHost, retrieveHosts } from './shred';
import { generateShredID,generateFileID,generateFileKey } from './keys_ids';
import { node, getPeers } from './peer';
import { getMasterKey, getFileMapKey, getUserName, getUserID } from './auth'

import {
  fileMapPath,
  NShreds,
  parity,
  pre_send_path,
  pre_store_path,
  downloadsDirPath,
  encryptedFileMapPath,
  brokerURL
} from './ENV_variables';


function fileToBuffer(path, callback) {
  if (fs.existsSync(path))  {
    fs.readFile(path, (err, data) => {
      if (err) return callback(null, err);
      return callback(data, null);
    });
  }
  else return callback(null, 'file does not exist');
}

function bufferToFile(path, buffer, callback) {
  fs.writeFile(path, buffer, (err) => {
    if (err) return console.log(err);
    return callback();
  });
}

function compress(buffer, callback) {
  // compress file with zlib
  zlib.gzip(buffer, (err, data) => {
    if (err) return console.log(null);
    return callback(data);
  });
}

function decompress(buffer, callback) {
  // decompress file with zlib
  zlib.gunzip(buffer, (err, data) => {
    if (err) return console.log(err);

    return callback(data);
  });
}

function encrypt(buffer, key, callback) {
  const algorithm = 'aes-256-ctr';
  const password = key;
  const encryptVar = crypto.createCipher(algorithm, password);

  const out = Buffer.concat([encryptVar.update(buffer), encryptVar.final()]);

  return callback(out);
}

function decrypt(buffer, key, callback) {
  const algorithm = 'aes-256-ctr';
  const password = key;
  const decryptVar = crypto.createDecipher(algorithm, password);

  const out = Buffer.concat([decryptVar.update(buffer), decryptVar.final()]);

  return callback(out);
}

// inputFile is the path-name of the file to be shredded
// Parity is a multiple of the number of shreds in the original file
// The % of shreds we can lose is = (Parity/(Parity+1))*100
function erasureCode(inputBuffer, dataShreds, parity, callback) {
  // inputFile is the path-name of the file to be shredded
  // Parity is a multiple of the number of shreds in the original file
  // The % of shreds we can lose is = (Parity/(Parity+1))*100

  const dataBuffer = inputBuffer;
  const dataShards = dataShreds;
  const shardLength = Math.ceil(dataBuffer.length / dataShards); // shredLength;
  const parityShards = parity * dataShards;
  const totalShards = dataShards + parityShards;
  // Create the parity buffer
  const parityBuffer = Buffer.alloc(parityShards * shardLength);
  const bufferOffset = 0;
  const bufferSize = shardLength * totalShards;
  const shardOffset = 0;
  const shardSize = shardLength - shardOffset;

  const buffer = Buffer.concat([
    dataBuffer,
    parityBuffer
  ], bufferSize);

  const rs = new ReedSolomon(dataShards, parityShards);
  rs.encode(
    buffer,
    bufferOffset,
    bufferSize,
    shardLength,
    shardOffset,
    shardSize,
    (error) => {
        if (error) throw error;

        // Parity shards now contain parity data.
        const shredsList = [];
        console.log('Total Shards: '+totalShards);

        // writing data shards as files
        for (let i = 0; i < totalShards; i++) { // Generate shred IDs to name the shreds
            shredsList.push(buffer.slice(i * shardLength, (i + 1) * shardLength));
          }

        callback(shredsList, shardLength);
    });
}

// shredsBuffer: a Buffer containing the shreds to be recovered,
// targets: a variable containing the indecies of the missing shreds
// dataShreds: Math.ceil(dataBuffer.length / shardLength)
// recoverdFile: the name of the file to be recovered
function erasureDecode(shredsBuffer, targets, parity, dataShreds, callback) {
  const buffer = new Buffer(shredsBuffer);
  const dataShards = dataShreds;
  const parityShards = parity * dataShards;
  const bufferOffset = 0;
  const totalShards = dataShards + parityShards;
  const shardLength = Math.ceil(buffer.length / totalShards); // shredLength;
  const bufferSize = shardLength * totalShards;
  const shardOffset = 0;
  const shardSize = shardLength - shardOffset;
  const rs = new ReedSolomon(dataShards, parityShards);

  rs.decode(
    buffer,
    bufferOffset,
    bufferSize,
    shardLength,
    shardOffset,
    shardSize,
    targets,
    (error) => {
        if (error) throw error;
        const dataLength = dataShards * shardLength;
        const restoredShreds = buffer.slice(bufferOffset, dataLength);
        callback(restoredShreds);
    });
}
function updateTimeStamp(callback) {
  console.log('updating time stamp');
  readFileMap((fileMap,error) => {
    if(error) { console.log('error reading' + error);return callback(null, 'error in reading FileMap');  }
    fileMap['stmp']  = Date.now();
    console.log('updated');
    storeFileMap(fileMap, () => {
      console.log('stored file map');
      return callback(fileMap['stmp'], null);
    });
  });
}

function storeFileMap(fileMap, callback) {
  // store FileMap in specified filemap path
  fs.writeFileSync(fileMapPath, JSON.stringify(fileMap));
  callback();
}

function createFileMap(callback) {
  // init file map
  const fileMap = {'stmp': 0, 'rnd':crypto.randomBytes(8).toString('hex'), 'userID':getUserID() };
  storeFileMap(fileMap, () => {
    callback();
  });
}

function encryptFileMap(callback) { //encrypts the fileMap and writes it on disk and returns the name of the encrypted Filename
  fileToBuffer(fileMapPath,(data, err)=>{
    encrypt(data, getFileMapKey(),(buffer)=>{
      return callback(buffer);
    });
  });
}

function decryptFileMap(data, callback) { //decreypts and replaces if exist the existing filemap
  decrypt(data, getFileMapKey() ,(buffer)=>{
    callback(buffer);
  });
}
function readFileMapBuffer(fileMapBuffer, callback) {
  try {
        const fileMap = JSON.parse(fileMapBuffer);
        return callback(fileMap,null);
  } catch(error)
   {
      return callback(null,error);
  }
}
function readFileMap(callback) {
  try {
    // load filemap from disk
    var fileMap;
    if (!fs.existsSync(fileMapPath)) {
      createFileMap(() => {
         fileMap = JSON.parse(fs.readFileSync(fileMapPath));
        });
    } else {
      fileMap = JSON.parse(fs.readFileSync(fileMapPath));
    }
    return callback(fileMap,null);

  } catch(error) {
    return callback(null,error);
  }
}

function getRemoteFileMap(remoteData, callback) { //  gets FileMap from boker & decrypts FileMap

  // optimization for future: only get hash of FileMap to check if local FileMap is up-to-date
  decryptFileMap(remoteData, (fileMapBuffer) => {
    readFileMapBuffer(fileMapBuffer, (remoteFileMap, err) => {
      if(err) {
         return callback(null,'Failed to decrypt remote FileMap');
       }
      readFileMap((fileMap, error)=>{
        if(error) {
          console.log(error);
            storeFileMap(remoteFileMap => {
            return callback(remotefileMap, null);
          });
         }
         console.log('successfully retrieved the remote fileMap');
         console.log(remoteFileMap);
         console.log('remote file map stamp: ' + remoteFileMap['stmp']);
         console.log('local file map stamp: ' + fileMap['stmp']);
         if ((remoteFileMap['stmp'] > fileMap['stmp']) || (fileMap['userID'] != getUserID())){
           console.log('broker is more updated');
           storeFileMap(remoteFileMap, ()=> {
           return callback(remoteFileMap, null);
           });
         }else {
           console.log('\tSuccessfully retrieved & decrypted the remote fileMap');
           return callback(fileMap,null);
         }
      });
    });
  });
}

function syncFileMap(callback) { // updates the remote FileMap
  encryptFileMap((fileMapBuffer)=>{  //syncing local and remote file map
    bufferToFile('encryptedFileMap', fileMapBuffer, ()=>{ //  now syncfing file map with broker
      console.log('\t successfully synced local encrypted file map');
      request.put(
        // filemap HTTP req path in broker
        brokerURL + 'update_filemap',
        {json: {username: getUserName(), fileMap: fileMapBuffer}},
        (error, response, body) => {
          console.log(body.message);
            if (!error && response.statusCode == 200) {
                console.log('file map synced with broker response filemap: ' + body.fileMap);
                return callback(null);
            } else return callback(error);
        }
      );
      console.log('\t successfully synced remote encrypted file map');
    });
  });
  // optimization: have queue to manage file uploads and "batch" loggin into fileMap
}

function addFileMapEntry(fileID, fileMapEntry, callback) {
  readFileMap((fileMap,error) => {
    if(error) { return callback('error in reading FileMap!!!!!!!!!!!!!');  }
    fileMap[fileID]  = fileMapEntry;
    storeFileMap(fileMap, () => {
      callback(null);
    });
  });
}

function removeFileMapEntryLocally(fileID, callback) {
  // self-explanatory
  readFileMap((fileMap,error) => {
    if(error) { return callback('error in reading FileMap');  }

    if (fileMap[fileID]) {
      fileMap[fileID] = undefined;
      storeFileMap(fileMap, () => {
        return callback(null);
      });
    }
    else return callback('Entry does not exist');
  });
}

function removeFileMapEntrySync(fileID, callback) {
   removeFileMapEntryLocally(fileID, ()=>{
     updateTimeStamp((time, error)=>{
       if (error){
         return callback(error);
       } else console.log('updated time stamp in file map');
       syncFileMap((err) => {
         if (err){
           return callback(err);
         }
         return callback();
       });
     });
   });
}

function shredFile(filename, filepath, NShreds, parity, callback) {
  const fileSize = fs.statSync(filepath).size;
  fileToBuffer(filepath, (loadedBuffer, err) => {
    if (!loadedBuffer){
      console.log('buffer not loaded');
      return callback(null);
    }
    compress(loadedBuffer, (compressedBuffer) => {
      generateFileID((fileID)=>{
        console.log('\tfile ID generated!\t' + fileID);
        generateFileKey(getMasterKey(), fileID, (fileKey) => {
          console.log('\tfile key generated!\t'+fileKey);
          encrypt(compressedBuffer, fileKey, (encryptedBuffer) => {
            erasureCode(encryptedBuffer, NShreds, parity, (shreds, shardLength) => {
              var shredIDs = [];
              const uploadTime = new Date().toISOString().
                                    substring(0,16).
                                    replace(/T/, ' ').
                                    replace(/\..+/, '');
              const saveShreds = (index, limit) => {
                generateShredID((newShredID)=>{
                  shredIDs.push(newShredID);
                  bufferToFile(`${pre_send_path}/${newShredID}`, shreds[index], () => {
                    if (index < limit - 1) {
                      saveShreds(index + 1, limit);
                    }
                    else {
                      readFileMap((fileMap,error) => {
                        if(error) { console.error('error in reading FileMapsss');console.log(error); return callback(null);  }
                        const fileMapSize = Object.keys(fileMap).length;
                        const deadbytes = shreds[0].length * NShreds - encryptedBuffer.length;
                        const fileMapEntry = {
                          name: filename,
                          shreds: shredIDs,
                          uploadTime: uploadTime,
                          key: fileKey,
                          salt: crypto.randomBytes(256),
                          parity: parity,
                          NShreds: NShreds,
                          size: fileSize,
                          shardLength: shardLength,
                          deadbytes: deadbytes
                        }
                        //const lastFileID = [Object.keys(fileMap)[fileMapSize-1]];
                          return callback(fileID, fileMapEntry, shredIDs);
                        });
                      }
                    });
                  });
                }
                const limit = shreds.length;
                saveShreds(0, limit);
              });
            });
          });
      });
    });
  });
}

function reconstructFile(fileID, targets, shredIDs, shredsPath, callback) {
  let buffer = new Buffer([]);

  // REFACTOR ME !!

  readFileMap((fileMap,error) => {
    if(error) { return callback('error in reading FileMap');  }
    const file = fileMap[fileID];
    if (!file) {
      console.log('file ID not in file map');
      return callback('file ID not in file map');
    }
    const { key, deadbytes, NShreds, parity, shardLength } = file;

    const readShreds = (index, limit, callback2) => { // readshreds function

      const shredPresent = ~targets & (1 << index);
      if (shredPresent) {
        // console.log('shred: ' + index);
        fileToBuffer(shredsPath + shredIDs[index], (data, err) => {
	         if(!data) {return callback2('error!,'+ shredIDs[index]+' is corrupted !')	}
            buffer = Buffer.concat([buffer, data]);
          if (index < limit - 1) readShreds(index + 1, limit, callback2);
          else  { return callback2(null);  }
        });
      } else {
        const emptyBuffer = Buffer.alloc(shardLength, '0');
        buffer = Buffer.concat([buffer, emptyBuffer]);
        if (index < limit - 1) readShreds(index + 1, limit, callback2);
        else {
          return callback2(null);
        }
      }
    };

    const limit = shredIDs.length;

    readShreds(0, limit, (err) => {
      if (err){
        console.error(err);
        return callback('some shreds are corrupted');
      }
      readFileMap((fileMap,error) => {
        if(error) { return callback('error in reading FileMap');  }
        const filename = fileMap[fileID]['name'];
        erasureDecode(buffer, targets, parity, NShreds, (loadedBuffer) => {
          const loadedBuffer2 = loadedBuffer.slice(0, loadedBuffer.length - deadbytes);
          decrypt(loadedBuffer2, key, (decryptedBuffer) => {
            decompress(decryptedBuffer, (decompressedBuffer) => {
              bufferToFile(downloadsDirPath+'/' + filename, decompressedBuffer, () => {
                console.log('Success!');
                for (const index in shredIDs) {
                  const filepath = shredsPath + shredIDs[index];
                  if ((shredIDs[index]) && (fs.existsSync(filepath))) {
                    fs.unlink(filepath, () => {});
                  }
                }
                return callback(null);
              });
            });
          });
        });
      });
    });
  });
}

function updateFileInState(state, fileKey, progressStatus, status) {
  const newFiles = [];
  state.files.forEach(file=>{
    if(file.id === fileKey){
      newFiles.push({...file, progressStatus: progressStatus, status: status});
    }
    else {
      newFiles.push(file);
    }
  });
  return newFiles;
}

function upload(filepath, setStateRef, stateRef, fileKey, callback) { //  to upload a file in Lynks

  const NShreds = 10;
  const parity = 2;

  const fileName = path.basename(filepath);
  const fileDirectory = path.dirname(filepath);

  setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, fileKey, 0, 'Shredding File...')});

  shredFile(fileName, filepath, NShreds, parity, (fileID, file, shredIDs) => {
    if ((!shredIDs)||(!file)) {
      return callback('error shredding file');
    }
    console.log ('Done shredding');

    setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, fileKey, 20, 'Getting Peers...')});

    // PEER SELECTION!!!!!!!!!!!!!!!!

    var shredsize = file.shardLength;

    getPeers(shredsize, (hosts)=> {
        if(!hosts.length)  {
          console.error('No peers available');
          return callback('couldnt fetch enough peers');
        }
        var sentCount = 0; // # of recieved Shreds
        var lastPeerIdx = 0;
        var shredsCopy=shredIDs.slice();
        let shredPeerInfo=[];

        setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, fileKey, 50, 'Uploading...')});

        async.doWhilst((whilst_callback) => { // try sent shreds to peers till all shredID are uploaded

            const peersToTry = [];

            for(var i=0; i<shredsCopy.length-sentCount;i++) { // loop on the remanning shredIDs to get New Peers to Try to Upload
              peersToTry.push(  hosts[ (lastPeerIdx+i) % hosts.length ]  );
            }
            //update the lastPeerIdx
            lastPeerIdx=(lastPeerIdx+shredsCopy.length-sentCount) % hosts.length;

            async.eachOf(peersToTry, (val, index, eachOfasyncCallback) =>{ //  loop to upload shreds to peers in parallel
                    const shredToTry=shredsCopy.pop();
                    storeShredRequest(val['ip'], val['port'], shredToTry, pre_send_path, (err) => { // sending to a single Peer
                     if(err)
                      {
                        shredsCopy.push(shredToTry); // roll back your changes
                        console.error(err);
                        return eachOfasyncCallback();
                      }
                     sentCount++;

                     setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, fileKey, 50+sentCount, 'Uploading...')});

                     console.log(sentCount+'/'+shredIDs.length);
                     shredPeerInfo.push({shred:shredToTry, id:val['id'] });
                     eachOfasyncCallback();
                   });

               }, (err) => {
                 if(sentCount!=shredIDs.length) console.log('Trying other '+(NShreds-sentCount)+' Peers');
                 whilst_callback();
               });
          },
            ()=> { // test function
                return sentCount < shredIDs.length ;
                },
            (err)=> { // after all shreds are uploaded or error was raised

              if(err) { console.error('error in Uploading shreds to Peers !'); return callback(err); }
              console.log('Done Sending Shreds');


                    for (var index in shredIDs) { // remove  shreds , async
                      fs.unlink(pre_send_path + shredIDs[index], () => {});
                        }

                  console.log('Uploading shreds to DHT');

                  setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, fileKey, 80, 'Updating DHT...')});

                  async.eachOf(shredPeerInfo, (val, index, asyncCallback_) =>{ //  loop to upload shred-host pairs in DHT

                    // BUG: given a wrong id, empty, it contiues without error
                    saveHost(val['shred'], val['id'], (err,numOfStored) =>{

                      if(err)  {  console.error('error in Uploading shred'+ val['shred'] +'  to DHT !'); return asyncCallback_(err); }
                      console.log('\tShred '+ val['shred'] +', was stored on total nodes of ' + numOfStored);

                      asyncCallback_();
                    });

                  }, (err) => { // after all shred-host pairs are uploaded on DHT
                    if(err)  {  console.error('error in Uploading shreds to DHT !'); return callback(err);
                  } else {

                  console.log('Done Uploading shreds to DHT');
                  console.log('Updating the encryptFileMap');

                  setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, fileKey, 90, 'Syncing filemap...')});

                  addFileMapEntry(fileID, file, (err) => {
                    if (err){
                      console.log('error adding file map entry');
                      return callback('error adding file map entry');
                    } else console.log('added file map entry');
                    updateTimeStamp((time, error)=>{
                      if (error){
                        return callback(error);
                      }else console.log('updated time stamp in file map');
                      syncFileMap((err) => {
                        if (err){
                          return callback(err);
                        }
                        console.log('Sync file map complete');
                        console.log('File upload complete!!!');

                        setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, fileKey, 100, 'Ready')});

                        return callback(null);
                      });
                  });
                });
              }
          });
      });
    });
  });
}

function download(FileID, setStateRef, stateRef, callback){  //to upload a file in Lynks

  const shredPeerInfo = [];

  setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, FileID, 0, 'Reading filemap...')});

  readFileMap((fileMap,error)=>{ //retrieve sherdIDs
    if(error) { return callback('error in reading FileMap');  }
    const file = fileMap[FileID];
    if(file)
    {
      const { shreds: shredIDs, key, salt, deadbytes, NShreds, parity, shardLength } = file;

      console.log('searching for the peerID of each shredID');

      setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, FileID, 20, 'Contacting hosts...')});

      async.each(shredIDs, (shredKey,asyncCallback) =>{ //  In parallel , loop to : 1)get shred-host pairs. 2) their info (IP & Port) from DHT
          retrieveHosts(shredKey, (err,PeerID, contacts)=>{ // 1) get PeerID via a ShredID

            if(err)  { return asyncCallback('error in getting peerID for shredID '+ shredKey +'  from DHT !'); }
            console.log('\tShredID '+ shredKey +', at HostID ' + PeerID.value);

            //iterativeFindNode: Basic kademlia lookup operation that builds a set of K contacts closest to the given key

            node.iterativeFindNode( PeerID.value, (error, contacts)=>{ // 2) get IP & Port via PeerID
              if (error)  { console.log('\t\terror in getting Peer info for PeerID '+ PeerID.value.hostname); asyncCallback(error); }

              const host= node.router.getContactByNodeId(PeerID.value);

              // BUG: for some reason the seed retuns perfect host info like IP & Port even Peer2 was disconnected after uploading. need to ping here maybe ?
              if(host==undefined) {
                console.error('\tWarning ! PeerID '+ PeerID.value +' is not in router. PeerID might be offline');
                return asyncCallback();
              }

              const hostIP = host.hostname
              const hostPort = host.port

              console.log('\t\tget shredID '+ shredKey +' via '  + hostIP + ':' + hostPort);
              shredPeerInfo.push({ shred:shredKey, ip:hostIP, port:hostPort})
              asyncCallback();
            });
          });
      }, (err) => { // after retrieving all shred-host pairs & their info

        if(err)  {  console.log('Aborting, erro in geting either shred-host pairs or their info (IP & Port) from DHT'); return callback(err); }
        console.log('Done retrieving all shred-host pairs from DHT');
        console.log('\tpossible shreds count is '+ shredPeerInfo.length);
        console.log('Receiving Shreds Now ..... ');

        setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, FileID, 50, 'Downloading...')});

        var receivedCount = 0; // # of recieved Shreds
        const receivedShredIDs =[]; // the info to be collected about the min.shreds to reconstruct File
        // const maxTotalBuffer = 400000000;  //to be safe
        // var shredsSent=0;   //number of shreds sent successfully
        // var start=0;  // index of shred ID to start with
        // var shredsDelivered = [];  //Shreds IDs of shreds that were successfully delivered
        // const shredsAtATime = Math.min(Math.floor(maxTotalBuffer/shardLength), NShreds);   //Maximum total number of shreds that can be sent asynchronously at a time (more than about 630000000 gives a memory leakage error)
        // console.log('shreds at a time: ' + shredsAtATime);
        // var shredsAttempted = 0;  //number of times a shred was being attempted to be sent
        async.doWhilst((whilst_callback) => { // try recieve the remanning shreds

            const shredPeerInfo_min = [];
            if(shredPeerInfo.length < (NShreds-receivedCount) ) { return whilst_callback('error, NOT Enough Shreds avaliable !');}
	    //for(var i=0;i <  Math.min(NShreds-receivedCount, shredsAtATime);i++)
            for(var i=0; i<NShreds-receivedCount;i++)
            {
              shredPeerInfo_min.push(shredPeerInfo.pop());
            }

            async.eachOf(shredPeerInfo_min, (request, index, eachOf_callback) =>{ //  loop to retrieving shreds in parallel.
                        getShredRequest(request.ip, request.port, request.shred, pre_store_path, (err)=> { // retrieving a single shred
                            //shredsAttempted++;
                            if(err) { console.error(err); return eachOf_callback(); }
                            receivedCount++;

                            setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, FileID, 50+receivedCount, 'Downloading...')});

                            console.log(receivedCount+'/'+NShreds);
                            receivedShredIDs.push(request.shred);
                            eachOf_callback();
                          });

                        },(err, n)=> { // file transmition finished

                            if(receivedCount!=NShreds) console.log('searching for other '+(NShreds-receivedCount)  );
                            whilst_callback();
                        });
          },
            ()=> { // test function
		//return ((receivedCount < NShreds)&&(shredsAttempted<NShreds)) ;
		 return receivedCount < NShreds ;
		},
            (err,)=> { // reconstruct File, after recieving the min. shreds

                if(err)  {  console.log('Aborting, could not recieve the min. #shreds'); return callback(err); }
                console.log('\tWill reconstruct via '+ receivedShredIDs.length +' shredIDs: ');
                console.log(receivedShredIDs);

                setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, FileID, 80, 'Reconstructing original file...')});

                // constructing the target binary string
                var requiredShreds = [];
                var targets = 0x3FFFFFFF;

                  //  using asyc lib to ensure this flow of loops
                async.eachOfSeries(shredIDs,(originalShred, index, eachOfSeries_callback_)=>{ // 1st loop to create the binary string
                  var exists;
                  if (receivedShredIDs.indexOf(originalShred) > -1) exists = index;
                  else exists=0;
                  requiredShreds.push(exists);
                  eachOfSeries_callback_();

                    },(err)=>{ // finished 1st loop
                      var targets = 0x3FFFFFFF;
                      async.eachSeries(requiredShreds,(required, eachSeries_callback_)=>{ // 2nd loop to create the targets
                        targets ^= (1 << required);
                        eachSeries_callback_();

                        },(err)=>{ // finished 2nd loop. Reconstructing File here

                          // console.log('targets: ' + targets.toString(2));
                          console.log('Reconstructing File ...');
                          reconstructFile(FileID, targets, shredIDs, pre_store_path, (err) => {
                            if (!err){
                                console.log('\tSuccess, File Reconstructed');

                                setStateRef({...stateRef, notification: false, files: updateFileInState(stateRef, FileID, 100, 'Downloaded')});

                                return callback(null);
                                } else {
                                  console.log('\tFailure, File reconstruction failed, error: ' + err);
                                  return callback(err);
                                  }
                              });
                        });
                    });
                  });
          });
    } else callback('error,bad fileID');  // bad fileID
  });
}


export {
  fileToBuffer,
  bufferToFile,
  compress,
  decompress,
  encrypt,
  decrypt,
  erasureCode,
  erasureDecode,
  storeFileMap,
  encryptFileMap,
  decryptFileMap,
  readFileMap,
  createFileMap,
  getRemoteFileMap,
  syncFileMap,
  addFileMapEntry,
  removeFileMapEntryLocally,
  removeFileMapEntrySync,
  shredFile,
  reconstructFile,
  upload,
  download
};
