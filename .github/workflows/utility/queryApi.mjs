//Purpose:
// to query APIs and record ('cache') the results for each result to a file.


//-- Imports --

import * as fs from 'fs';
import * as zone from './assetlist_functions.mjs';





//-- Global Variables --

const queryResponsesDirectoryName = "query_responses";






//-- Functions --

//--Query URL--
export async function queryAPI(baseUrl, params, chainName, fileName) {

  console.log(baseUrl);
  const options = {
    method: 'GET',
    accept: 'application/json'
  }
  let url;
  let response;
  let result;
  let param = null;
  let paginationKey = "";
  const paginationLimit = 2000;
  
  param = `?pagination.limit=${paginationLimit}`
  if(param) {
    url = baseUrl + param;
  }
  response = await fetch(url,options);
  result = await response.json();
  if (!result) { 
    console.log("No result to: ${url}");
    return;
  }
  //console.log(result);

  await zone.writeToFile(chainName, queryResponsesDirectoryName, fileName, result);
  console.log("Saved API Query Response!");

}

//--Read Query Response--
export function readQueryResponse(chainName, fileName) {
  return zone.readFromFile(chainName, queryResponsesDirectoryName, fileName);
}