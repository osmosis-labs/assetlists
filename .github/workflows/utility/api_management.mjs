import * as zone from "./assetlist_functions.mjs";

export const Status = Object.freeze({
  FAILURE: "FAILURE",
  SUCCESS: "SUCCESS"
});


export async function queryApi(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`Error fetching data: ${response.statusText}`);
      return;
    }
    const data = await response.json();
    console.log("Successfully fetched API Data.");
    return data;
  } catch (error) {
    console.log('Error fetching data:', error);
    return;
  }
}

export async function queryKeys(query, keys, condition, conditionMet, conditionNotMet) {
  for (let i = 0; i < query.limit && i < keys?.length; i++) {
    const rawData = await query.function(keys[i]);
    if (condition(rawData)) {
      console.log(`Condition met for ${keys[i]}.`);
      conditionMet.push(keys[i]);
    } else {
      console.log(`Condition not met for ${keys[i]}`);
      conditionNotMet.push(keys[i]);
    }
    await zone.sleep(query.sleepTime);
  }
}