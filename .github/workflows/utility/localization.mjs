// Purpose:
//   to generate the zone_config json using the zone json and chain registry data


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as path from 'path';
import * as fs from 'fs';



//-- Globals --

const file_extension = ".json";
const asset_detail_file_name_middle = "_asset_detail_";
const default_localization_code = "en";


//-- Directories --

export const zoneAssetDetail = path.join(zone.generatedDirectoryName, "asset_detail");
export const inlangInputOutput = "language_files";



//-- Functions --

export function setAssetDetailLocalizationInput(chainName, assets) {

  let assetSymbolPlaceholder;
  let currentDescription;

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
    if (!asset.description || !asset.symbol) { return; }
    assetSymbolPlaceholder = asset.symbol.replace(/\./g, "(dot)");

    currentDescription = getAssetDetail(chainName, asset.symbol, default_localization_code)?.description;

    
    if (currentDescription === asset.description) { return; }

    inlangInput[chainName][assetSymbolPlaceholder] = {
        description: asset.description
    };

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
  
  const localized_properties = [
    "description"
  ];

  const localization_codes = getLocalizationCodes();

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
  inlangOutput[default_localization_code].forEach((chain) => {
    savedTranlsations[chain] = {};
    chain.forEach((asset) => {
      savedTranslations[chain][asset] = {};
      asset.forEach((property) => {
        savedTranslations[chain][asset][property] = {};
        localization_codes.forEach((localization) => {
          if (!inlangOutput[localization][chain][asset][property]) { return; }
          savedTranslations[chain][asset][property][localization] = inlangOutput[localization][chain][asset][property];
        });
        if (Object.keys(savedTranslations[chain][asset][property]).length !== localization_codes.length) {
          delete savedTranslations[chain][asset][property];
        }
      });
      if (Object.keys(savedTranslations[chain][asset]).length === 0) {
        delete savedTranslations[chain][asset];
      }
    });
    if (Object.keys(savedTranslations[chain]).length === 0) {
      delete savedTranslations[chain];
    }
  });


  //Write Saved Localization Data to Files
  savedTranslations.forEach((chain) => {

    //Read Asset Detail
    const assetDetailAssetlist = zone.readFromFile(
      chain,
      zone.zoneAssetDetail,
      zone.assetlistFileName
    )?.assets || [];

    chain.forEach((asset) => {

      //Write to Localized Files
      const asset_symbol = Object.keys(asset).replace(/\(dot\)/g, ".");
      //Asset Detail
      const updated_asset_detail = assetDetailAssetlist.find(item => item.symbol === asset_symbol); // param?
      
      localization_codes.forEach((localization_code) => { // function?

        //Asset Detail
        let localized_asset_detail = {
          localization: localization_code
        };
        const fileLocation =
          asset_detail.symbol.toLowerCase() + asset_detail_file_name_middle + localization_code + file_extension;
        try {
          const fileContent = fs.readFileSync(fileLocation);
          const existing_asset_detail = JSON.parse(fileContent);
        } catch {}
        existing_asset_detail.forEach((property) => {   // this may contain existing translated data
          localized_asset_detail[property] = property;
        });
        updated_asset_detail.forEach((property) => {   // this contains the most up to date data
          if (localized_properties.includes(property)) { return; }   // but we skip any translated data
          localized_asset_detail[property] = property;
        });
        asset.forEach((property) => {   // this contains new translated data
          localized_asset_detail[property] = savedTranslations[chain][asset][property]; // param?
        });
        zone.writeToFile(
          chain,
          zone.zoneAssetDetail,
          fileLocation,
          localized_asset_detail
        );
      });
    });
  });


  //extract relevant data from localizations
  //setLocalizedDescriptions(inlangOutput[localization_code], localization_code);
  //for more translated data, add function calls here


  localization_codes.forEach((localization_code) => {
    //once done, delete the input and output
    if (inlangOutput[localization_code]) {
      try {
        // Delete the file synchronously
        fs.unlinkSync(fileLocation);
        console.log(`File ${fileLocation} deleted successfully`);
      } catch (err) {
        console.error(`Error deleting file ${fileLocation}:`, err);
      }
    }
  });

}

export function setLocalizedDescriptions(inlangOutput, localization_code) {

  let assetDetailAssetlist;

  let asset_detail;
  let asset_symbol;

  if (!inlangOutput) { return; }

  zone.chainNames.forEach((chainName) => {
    if (!inlangOutput[chainName]) { return; }

    //read Asset Detail
    assetDetailAssetlist = zone.readFromFile(
      chainName,
      zone.zoneAssetDetail,
      zone.assetlistFileName
    )?.assets || [];

    Object.keys(inlangOutput[chainName]).forEach((assetSymbolPlaceholder) => {

      //prepare the object for Asset Detail
      asset_symbol = assetSymbolPlaceholder.replace(/\(dot\)/g, ".");
      asset_detail = assetDetailAssetlist.find(item => item.symbol === asset_symbol);
      asset_detail.description = inlangOutput[chainName][assetSymbolPlaceholder].description
      asset_detail = { localization: localization_code, ...asset_detail }

      //write Asset Detail
      zone.writeToFile(
        chainName,
        zone.zoneAssetDetail,
        asset_detail.symbol.toLowerCase() + asset_detail_file_name_middle + localization_code + file_extension,
        asset_detail
      );
    });
    
  });

}


export function getAssetDetail(chainName, asset_symbol, localization_code) {

  let asset_detail = {};
  try {

    // Read from the file
    let fileLocation = zone.getFileLocation(
      chainName,
      zone.zoneAssetDetail,
      asset_symbol.toLowerCase() + asset_detail_file_name_middle + localization_code + file_extension
    );
    const fileContent = fs.readFileSync(fileLocation);

    // Parse the JSON content
    asset_detail = JSON.parse(fileContent);

  } catch {
    asset_detail = {};
  }
  return asset_detail;

}


export function setAssetDetailAll() {
  
  const localization_codes = getLocalizationCodes();
  let asset_detail, localized_asset_detail;

  zone.chainNames.forEach((chainName) => {
    
    const asset_detail_assets = zone.readFromFile(
      chainName,
      zone.zoneAssetDetail,
      zone.assetlistFileName
    )?.assets || [];
    
    //iterate asset_detail/assetlist
    asset_detail_assets.forEach((asset) => {
    
      //compare against the english output file

      asset_detail = getAssetDetail(chainName, asset.symbol, default_localization_code);

      if (
        asset_detail &&
        asset.name === asset_detail?.name &&
        asset.symbol === asset_detail?.symbol &&
      //asset.description === asset_detail?.description &&
        asset.coingeckoID === asset_detail?.coingeckoID &&
        asset.websiteURL === asset_detail?.websiteURL &&
        asset.twitterURL === asset_detail?.twitterURL
      ) {
        return;
      }

      localization_codes.forEach((localization_code) => {

        localized_asset_detail = getAssetDetail(chainName, asset.symbol, localization_code);
        asset_detail = { localization: localization_code, ...asset }
        asset_detail.description = localized_asset_detail.description;
        //console.log(asset_detail);
        //console.log(localized_asset_detail);

        //write Asset Detail
        zone.writeToFile(
          chainName,
          zone.zoneAssetDetail,
          asset.symbol.toLowerCase() + asset_detail_file_name_middle + localization_code + file_extension,
          asset_detail
        );
      
      });
    
    });

  });

};
