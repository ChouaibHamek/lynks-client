import ReedSolomon from 'reed-solomon';
import crypto from 'crypto';
import zlib from 'zlib';
import ObjectID from 'bson-objectid';
import path from 'path';
import async from 'async';
import fs from 'fs';

import { storeShredRequest, getShredRequest, generateShredID, saveHost, retrieveHosts } from './shred';
import { node } from './peer';


const fileMapPath = 'filemap.json';
const pre_send_path = './pre_send/';
const pre_store_path = './pre_store/';




function getFileList() {
  return 0;
}

function fileToBuffer(path, callback) {
  fs.readFile(path, (err, data) => {
    if (err) return console.log(err);
    return callback(data);
  });
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
    if (err) return console.log(err);
    return callback(data);
  });
}

function decompress(filepath, callback) {
  // decompress file with zlib
  const gunzip = zlib.createGunzip();
  let newfilepath;
  if (filepath.indexOf('_decrypted') > -1) {
    newfilepath = `${filepath.substr(0, filepath.length - 10)}_copy`;
  } else {
    newfilepath = `${filepath}_copy`;
  }
  const compressedfile = fs.createReadStream(filepath);
  const decompressedfile = fs.createWriteStream(newfilepath);
  compressedfile.pipe(gunzip).pipe(decompressedfile);
  fs.unlinkSync(filepath);
  if (callback) {
    compressedfile.on('end', callback);
  }
  // return decompressed file name
  return newfilepath;
}

function encrypt(filepath, key, callback) {
  const algorithm = 'aes-256-ctr';
  const password = key;
  let newfilepath;
  if (filepath.indexOf('.Gzip') > -1) {
    newfilepath = `${filepath.substr(0, filepath.length - 5)}_encrypted`;
  } else {
    newfilepath = `${filepath}_encrypted`;
  }
  const encryptVar = crypto.createCipher(algorithm, password);
  const compressedfileRead = fs.createReadStream(filepath);
  const compressedfileWrite = fs.createWriteStream(newfilepath);
  compressedfileRead.pipe(encryptVar).pipe(compressedfileWrite);
  fs.unlinkSync(filepath);
  if (callback) {
    compressedfileRead.on('end', callback);
  }
  // return encrypted file name
  return newfilepath;
}

function decrypt(filepath, key, callback) {
  const algorithm = 'aes-256-ctr';
  const password = key;
  let newfilepath;
  if (filepath.indexOf('_encrypted') > -1) {
    newfilepath = `${filepath.substr(0, filepath.length - 10)}_decrypted`;
  } else {
    newfilepath = `${filepath}_decrypted`;
  }
  const decryptVar = crypto.createDecipher(algorithm, password);
  const compressedfileRead = fs.createReadStream(filepath);
  const compressedfileWrite = fs.createWriteStream(newfilepath);
  compressedfileRead.pipe(decryptVar).pipe(compressedfileWrite);
  fs.unlinkSync(filepath);
  if (callback) {
    compressedfileRead.on('end', callback);
  }
  // return decrypted file name
  return newfilepath;
}

// inputFile is the path-name of the file to be shredded
// Parity is a multiple of the number of shreds in the original file
// The % of shreds we can lose is = (Parity/(Parity+1))*100
function shredFile(parity, shredLength, inputFile) {
  const bitmap = fs.readFileSync(inputFile);
  const dataBuffer = new Buffer(bitmap);
  const shardLength = shredLength;
  const dataShards = Math.ceil(dataBuffer.length / shardLength);
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
function recoverFile(shredsBuffer, targets, parity, shredLength, dataShreds, recoveredFile) {
  const buffer = new Buffer(shredsBuffer);
  const shardLength = shredLength;
  const dataShards = dataShreds;
  const parityShards = parity * dataShards;
  const bufferOffset = 0;
  const totalShards = dataShards + parityShards;
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


function storeFileMap(fileMap, callback) {
>>>>>>> develop
  // store FileMap in specified filemap path
  fs.writeFileSync(fileMapPath, JSON.stringify(fileMap));
  callback();
}

function readFileMap(callback) {
  // load filemap from disk
  const fileMap = JSON.parse(fs.readFileSync(fileMapPath));
  callback(fileMap);
}

function createFileMap(callback) {
  // init file map
  const fileMap = {};
  storeFileMap(fileMap, () => {
    callback();
  });
}

function getFileMap() {
  // get FileMap from server, decrypt it
  // load FileMap into App runtime

  // optimization for future: only get hash of FileMap to check if local FileMap is up-to-date
}

function syncFileMap() {
  // update remote FileMap
  // 1. encrypt local FileMap
  // 2. make update request to server

  // optimization: have queue to manage file uploads and "batch" loggin into fileMap

}

function addFileMapEntry(fileID, fileMapEntry, callback) {
  readFileMap((fileMap) => {
    fileMap[fileID]  = fileMapEntry;
    storeFileMap(fileMap, () => {
      callback();
    });
  });
}

function removeFileMapEntry(fileID, callback) {
  // self-explanatory
  readFileMap((fileMap) => {
    fileMap[fileID] = undefined;
    storeFileMap(fileMap, () => {
      callback();
    });
  });
}


function shredFile(filename, filepath, key, NShreds, parity, callback) {
  fileToBuffer(filepath, (loadedBuffer) => {
    compress(loadedBuffer, (compressedBuffer) => {
      encrypt(compressedBuffer, key, (encryptedBuffer) => {
        erasureCode(encryptedBuffer, NShreds, parity, (shreds, shardLength) => {
          var shredIDs = [];

          const saveShreds = (index, limit) => {
            /* const newShredID = */ generateShredID((newShredID)=>{
              shredIDs.push(newShredID);

              bufferToFile(`${pre_send_path}/${newShredID}`, shreds[index], () => {
                if (index < limit - 1) {
                  saveShreds(index + 1, limit);
                }
                else {
                  readFileMap((fileMap) => {
                    const fileMapSize = Object.keys(fileMap).length;
                    const deadbytes = shreds[0].length * NShreds - encryptedBuffer.length;
                    const fileMapEntry = {
                      name: filename,
                      shreds: shredIDs,
                      key: key,
                      salt: crypto.randomBytes(256),
                      parity: parity,
                      NShreds: NShreds,
                      shardLength: shardLength,
                      deadbytes: deadbytes
                    }
                    const lastFileID = [Object.keys(fileMap)[fileMapSize-1]];
                    addFileMapEntry(lastFileID == '' ? 1 : parseInt(lastFileID) + 1, fileMapEntry, () => {
                      callback(shredIDs);
                    });
                  });
                }
              });
            });

          };
          const limit = shreds.length;
          saveShreds(0, limit);
        });
      });
    });
  });
}


function reconstructFile(fileID, targets, shredIDs, shredsPath, callback) {
  let buffer = new Buffer([]);

  // REFACTOR ME !!

  readFileMap((fileMap) => {
    const file = fileMap[fileID];
    const { key, deadbytes, NShreds, parity, shardLength } = file;

    const readShreds = (index, limit, callback2) => {
      const shredPresent = ~targets & (1 << index);
      //
      // console.log('index ' + index + ' -- ' + shredPresent);



      if (shredPresent) {
        // console.log('shred: ' + index);
        fileToBuffer(shredsPath + shredIDs[index], (data) => {
          buffer = Buffer.concat([buffer, data]);
          if (index < limit - 1) readShreds(index + 1, limit, callback2);
          else {
            callback2();
          }
        });
      } else {
        const emptyBuffer = Buffer.alloc(shardLength, 'b');
        buffer = Buffer.concat([buffer, emptyBuffer]);
        if (index < limit - 1) readShreds(index + 1, limit, callback2);
        else {
          callback2();
        }
      }
    };

    const limit = shredIDs.length;

    readShreds(0, limit, () => {
      readFileMap((fileMap) => {
        const filename = fileMap[fileID]['name'];
        if (!fileMap[fileID]) {
          console.log('error!!!');
          callback('error');
        }
        erasureDecode(buffer, targets, parity, NShreds, (loadedBuffer) => {

          const loadedBuffer2 = loadedBuffer.slice(0, loadedBuffer.length - deadbytes);
          decrypt(loadedBuffer2, key, (decryptedBuffer) => {
            decompress(decryptedBuffer, (decompressedBuffer) => {
              bufferToFile('./Downloads/' + filename, decompressedBuffer, () => {
                console.log('Success!');
                for (const index in shredIDs) {
                  if (shredIDs[index]) {
                    fs.unlink(shredsPath + shredIDs[index], () => {});
                  }
                }
                callback();
              });
            });
          });
        });
      });
    });
  });
}

function upload(filepath, callback) { //  to upload a file in Lynks

    // call peer.getPeers()
    // peer selection ^

    //  --------------------fixed,need to change-------------------

  const peerIP='192.168.1.21'
  const hosts = []
  for (let f = 0; f < 15; f++)
  {
    //10.7.57.202
    hosts.push({ ip: peerIP, port: 2345, id: Buffer.from('TEST_ON_YEHIA_HESHAM').toString('hex') })
  }

  for (let f = 0; f < 15; f++)
  {
    //10.7.57.202
    hosts.push({ ip: peerIP, port: 2346, id: Buffer.from('cxc').toString('hex') })
  }

  const key = 'FOOxxBAR';

  //  --------------------fixed,need to change-------------------

  const NShreds = 10;
  const parity = 2;



  const fileName = path.basename(filepath);
  const fileDirectory = path.dirname(filepath);


  shredFile(fileName, filepath, key, NShreds, parity, (shredIDs) => {

    console.log ('Done shredding');
    async.eachOf(shredIDs, (val, index, asyncCallback) =>{ //  loop to upload shreds to peers in parallel


        //TODO: we need to try n times before aborting, here it aborts from single failure
        storeShredRequest(hosts[index]['ip'], hosts[index]['port'], val,pre_send_path, (err) => { // sending to a single Peer
          if(err) { console.error(err); return asyncCallback();}
          asyncCallback();
        });

    }, (err) => { // after all shreds are uploaded or error was raised

      if(err) { console.error('error in Uploading shreds to Peers !'); return callback(err); }
      console.log('Done Sending Shreds');


      for (var index in shredIDs) { // remove  shreds , async
        fs.unlink(pre_send_path + shredIDs[index], () => {});
          }

          async.eachOf(shredIDs, (val, index, asyncCallback_) =>{ //  loop to upload shred-host pairs in DHT

            // BUG: given a wrong id, empty, it contiues without error
            saveHost(val, hosts[index]['id'], (err,numOfStored) =>{

              if(err)  {  console.error('error in Uploading shred'+ val +'  to DHT !'); return asyncCallback_(err); }
              console.log('Shred '+ val +', was stored on total nodes of ' + numOfStored);

              asyncCallback_();
            });

          }, (err) => { // after all shred-host pairs are uploaded on DHT

            if(err)  {  console.error('error in Uploading shreds to DHT !'); return callback(err); }
            console.log('done Uploading shreds to DHT');

            callback(null);
          });
        });
    });
}

function download(FileID,callback){  //to upload a file in Lynks

  const shredPeerInfo = [];

  readFileMap((fileMap)=>{ //retrieve sherdIDs
    const file = fileMap[FileID];
    if(file)
    {
      const { shreds: shredIDs, key, salt, deadbytes, NShreds, parity } = file;

      console.log('searching for the peerID of each shredID');

      async.each(shredIDs, (shredKey,asyncCallback) =>{ //  In parallel , loop to : 1)get shred-host pairs. 2) their info (IP & Port) from DHT
          retrieveHosts(shredKey, (err,PeerID, contacts)=>{ // 1) get PeerID via a ShredID

            if(err)  { return asyncCallback('error in getting peerID for shredID '+ shredKey +'  from DHT !'); }
            console.log('ShredID '+ shredKey +', at HostID ' + PeerID.value);

            //iterativeFindNode: Basic kademlia lookup operation that builds a set of K contacts closest to the given key

            node.iterativeFindNode( PeerID.value, (error, contacts)=>{ // 2) get IP & Port via PeerID
              if (error)  { console.log('\terror in getting Peer info for PeerID '+ PeerID.value.hostname); asyncCallback(error); }

              const host= node.router.getContactByNodeId(PeerID.value);

              // BUG: for some reason the seed retuns perfect host info like IP & Port even Peer2 was disconnected after uploading. need to ping here maybe ?
              if(host==undefined) {
                console.error('Warning ! PeerID '+ PeerID.value +' is not in router. PeerID might be offline');
                return asyncCallback();
              }

              const hostIP = host.hostname
              const hostPort = host.port

              console.log('\tget shredID '+ shredKey +' via '  + hostIP + ':' + hostPort);
              shredPeerInfo.push({ shred:shredKey, ip:hostIP, port:hostPort})
              asyncCallback();
            });
          });
      }, (err) => { // after retrieving all shred-host pairs & their info

        if(err)  {  console.log('Aborting, erro in geting either shred-host pairs or their info (IP & Port) from DHT'); return callback(err); }
        console.log('Done retrieving all shred-host pairs from DHT');
        console.log('possible shreds count is '+ shredPeerInfo.length);
        console.log('Receiving Shreds Now ..... ');

        var receivedCount = 0; // # of recieved Shreds
        const receivedShredIDs =[]; // the info to be collected about the min.shreds to reconstruct File

        async.doWhilst(
          (whilst_callback)=>{ // try recieve the remanning shreds


            const shredPeerInfo_min = [];
            if(shredPeerInfo.length < (NShreds-receivedCount) ) { return whilst_callback('error, NOT Enough Shreds avaliable !');}
            for(var i=0; i<NShreds-receivedCount;i++)
            {
              shredPeerInfo_min.push(shredPeerInfo.pop());
            }

            async.eachOf(shredPeerInfo_min, (request, index, eachOf_callback) =>{ //  loop to retrieving shreds in parallel.
                        getShredRequest(request.ip, request.port, request.shred, pre_store_path, (err)=> { // retrieving a single shred
                            if(err) { console.error(err); return eachOf_callback(); }
                            receivedCount++;
                            console.log(receivedCount+'/'+NShreds);
                            receivedShredIDs.push(request.shred);
                            eachOf_callback();
                          });

                        },(err, n)=> { // file transmition finished

                            if(receivedCount!=NShreds) console.log('searching for other '+(NShreds-receivedCount)  );
                            whilst_callback();
                        });
          },
            ()=> { return receivedCount < NShreds ; }, // test function
            (err,)=> { // reconstruct File, after recieving the min. shreds

                if(err)  {  console.log('Aborting, could not recieve the min. #shreds'); return callback(err); }
                console.log('will reconstruct via '+ receivedShredIDs.length +' shredIDs: ');
                console.log(receivedShredIDs);

                // constructing the target binary string
                var requiredShreds = [];
                var targets = 0x3FFFFFFF;

                  //  using asyc lib to ensure this flow of loops
                async.eachOfSeries(shredIDs,(originalShred, index, eachOfSeries_callback_)=>{ // 1st loop to create the binary string
                  var exists;
                  if (receivedShredIDs.indexOf(originalShred) > -1) exists=index;
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
                          reconstructFile(FileID, targets, shredIDs, pre_store_path, () => {
                              console.log('File Reconstructed');
                              callback(null); //Success
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
  shredFile,
  recoverFile,
  encrypt,
  decrypt,
  getFileList,
  createFileMap,
  getFileMap,
  syncFileMap,
  addFileMapEntry,
  removeFileMapEntry,
  readFileMap,
  shredFile,
  reconstructFile,
  upload,
  download
};