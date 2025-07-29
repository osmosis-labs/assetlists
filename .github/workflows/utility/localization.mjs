// Purpose:
//   to generate the zone_config json using the zone json and chain registry data


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as path from 'path';
import * as fs from 'fs';



//-- Globals --

const file_extension = ".json";
const default_localization_code = "en";
const localization_codes = getLocalizationCodes();
const localized_properties = [
  "description"
];


//-- Directories --

export const zoneAssetDetail = path.join(zone.generatedDirectoryName, "asset_detail");
export const inlangInputOutput = "language_files";



//-- Functions --

export function setAssetDetailLocalizationInput(chainName, assets) {

  let inlangInput;
  const filePath = path.join(zone.assetlistsRoot, inlangInputOutput, default_localization_code + file_extension);
  try {
    inlangInput = JSON.parse(fs.readFileSync(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      // If the file doesn't exist, create the directory and the file
      try {
        fs.mkdirSync(path.join(zone.assetlistsRoot, inlangInputOutput));
        console.log("Directory successfully created");
      } catch (error) {
        if (error.code === 'EEXIST') {
          console.log("Language Files directory already exists.");
        } else {
          throw error;
        }
      }
      inlangInput = {};
    } else {
        throw error;
    }
  }
  inlangInput[chainName] = inlangInput[chainName] || {};

  assets.forEach((asset) => {

    for (const propertyName in localized_properties) {

      if (!asset[propertyName]) { return; }
      const currentValue = getAssetDetail(chainName, asset.base)?.[propertyName]?.[default_localization_code];
      if (currentValue === asset[propertyName]) { return; }

      inlangInput[chainName][asset.base] = {
        [propertyName]: asset[propertyName]
      };

    }

  });

  zone.writeToFile(
    zone.noDir,
    inlangInputOutput,
    default_localization_code + file_extension,
    inlangInput
  );

}


export function getLocalizationCodes() {

  const directory = path.join(zone.assetlistsRoot, "languages");
  const filesInDirectory = zone.getFilesInDirectory(directory) || [];
  return filesInDirectory.map(file => path.basename(file, path.extname(file))) || [];

}


export function getLocalizationOutput() {

  //Read Language Files
  let inlangOutput = {};
  localization_codes.forEach((localization_code) => {
    try {
      const fileLocation = zone.getFileLocation(
        zone.noDir,
        inlangInputOutput,
        localization_code + file_extension
      );
      const fileContent = fs.readFileSync(fileLocation);
      inlangOutput[localization_code] = JSON.parse(fileContent);
    } catch {}
  });


  //Save Localization Output into new Object
  let savedTranslations = {};
  for (const chainName in inlangOutput[default_localization_code]) {
    const chain = inlangOutput[default_localization_code][chainName];
    savedTranslations[chainName] = {};
    for (const assetName in chain) {
      const asset = chain[assetName];
      savedTranslations[chainName][assetName] = {};
      for (const propertyName in asset) {
        const property = asset[propertyName];
        savedTranslations[chainName][assetName][propertyName] = {};
        localization_codes.forEach((localization) => {
          if (!inlangOutput[localization]?.[chainName]?.[assetName]?.[propertyName]) { return; }
          savedTranslations[chainName][assetName][propertyName][localization] = 
            inlangOutput[localization][chainName][assetName][propertyName];
        });
        if (Object.keys(savedTranslations[chainName][assetName][propertyName]).length !== localization_codes.length) {
          delete savedTranslations[chainName][assetName][propertyName];
        }
      }
      if (Object.keys(savedTranslations[chainName][assetName]).length === 0) {
        delete savedTranslations[chainName][assetName];
      }
    }
    if (Object.keys(savedTranslations[chainName]).length === 0) {
      delete savedTranslations[chainName];
    }
  }


  //Write Saved Localization Data to Files
  //savedTranslations.forEach((chain) => {
  for (const chainName in savedTranslations) {
    const chain = savedTranslations[chainName];

    for (const asset_base in chain) {
      const localized_asset_detail_properties = chain[asset_base];

      let asset_detail = getAssetDetail(chainName, asset_base) || {};

      for (const propertyName in localized_asset_detail_properties) {   // this only contains new localized data
        asset_detail[propertyName] = localized_asset_detail_properties[propertyName];
      }

      zone.writeToFile(
        chainName,
        zone.zoneAssetDetail,
        getAssetDetailFileName(asset_base),
        asset_detail
      );

    }
  }

  localization_codes.forEach((localization_code) => {
    //once done, delete the input and output
    let fileLocation = path.join(zone.assetlistsRoot, inlangInputOutput, localization_code);
    if (inlangOutput[localization_code]) {
      try {
        // Delete the file synchronously
        fs.unlinkSync(fileLocation + file_extension);
        console.log(`${fileLocation}${file_extension} deleted successfully`);
      } catch (err) {
        console.error(`Error deleting ${fileLocation}${file_extension}:`, err);
      }
    }
  });

}

//will soon be able to delete this
export function setLocalizedDescriptions(inlangOutput, localization_code) {

  let assetDetailAssetlist;

  let asset_detail;

  if (!inlangOutput) { return; }

  zone.chainNames.forEach((chainName) => {
    if (!inlangOutput[chainName]) { return; }

    //read Asset Detail
    assetDetailAssetlist = zone.readFromFile(
      chainName,
      zone.zoneAssetDetail,
      zone.assetlistFileName
    )?.assets || [];

    Object.keys(inlangOutput[chainName]).forEach((asset) => {

      //prepare the object for Asset Detail
      asset_detail = assetDetailAssetlist.find(item => item.base === asset.base);
      asset_detail.description = inlangOutput[chainName][asset.base].description
      asset_detail = { localization: localization_code, ...asset_detail }

      //write Asset Detail
      zone.writeToFile(
        chainName,
        zone.zoneAssetDetail,
        asset.base.replace(/\//g, "%2F") + "_" + localization_code + file_extension,
        asset_detail
      );
    });
    
  });

}


export function getAssetDetail(chainName, asset_base) {

  let asset_detail = {};

  try {

    // Read from the file
    asset_detail = zone.readFromFile(
      chainName,
      zone.zoneAssetDetial,
      getAssetDetailFileName(asset_base)
    );

  } catch {}
  return asset_detail;

}

export function setAssetDetail(chainName, asset_base, asset_detail) {

  zone.writeToFile(
    chainName,
    zone.zoneAssetDetail,
    getAssetDetailFileName(asset_base),
    asset_detail
  );

}

export function getAssetDetailFileName(asset_base) {
  return asset_base.replace(/\//g, "%2F") + file_extension;
}


export function setAssetDetailAll() {

  zone.chainNames.forEach((chainName) => {

    //Read Asset Detail
    const assetDetailAssetlist = zone.readFromFile(
      chainName,
      zone.zoneAssetDetail,
      zone.assetlistFileName
    )?.assets || [];
    
    //iterate asset_detail/assetlist
    assetDetailAssetlist.forEach((asset) => {
    
      let asset_detail = getAssetDetail(chainName, asset.base) || {};

      let change = false;

      for (const propertyName in asset) {
        if (localized_properties.include(propertyName)) continue;
        if (asset_detail[propertyName] !== asset[propertyName]) {
          asset_detail[propertyName] === asset[propertyName];
          change = true;
        }
      }

      //write Asset Detail
      if (change) {
        zone.writeToFile(
          chainName,
          zone.zoneAssetDetail,
          getAssetDetailFileName(asset.base),
          asset_detail
        );
      }

    });
  });
};
