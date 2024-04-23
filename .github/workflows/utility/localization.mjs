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
export const inlangInputOutput = path.join("languages", "language_files");



//-- Functions --

export function setAssetDetailLocalizationInput(chainName, assets) {

  let assetSymbolPlaceholder;
  let currentDescription;

  let inlangInput = zone.readFromFile(
    zone.noDir,
    inlangInputOutput,
    default_localization_code + file_extension
  ) || {};
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

  const directory = path.join(zone.assetlistsRoot, inlangInputOutput);
  const filesInDirectory = zone.getFilesInDirectory(directory) || [];
  return filesInDirectory.map(file => path.basename(file, path.extname(file))) || [];

}


export function getLocalizationOutput() {
  
  let inlangOutput = {};

  const localization_codes = getLocalizationCodes();

  localization_codes.forEach((localization_code) => {
  
    inlangOutput[localization_code] = zone.readFromFile(
      zone.noDir,
      inlangInputOutput,
      localization_code + file_extension
    ) || {};

    //extract relevant data from localizations
    setLocalizedDescriptions(inlangOutput[localization_code], localization_code);

    //once done, delete the output

  });

}

export function setLocalizedDescriptions(inlangOutput, localization_code) {

  let assetDetailAssetlist;

  let asset_detail;
  let asset_symbol;

  zone.chainNames.forEach((chainName) => {
    if (!inlangOutput[chainName]) { return; }

    //read Asset Detail
    assetDetailAssetlist = zone.readFromFile(
      chainName,
      zoneAssetDetail,
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
        zoneAssetDetail,
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
      zoneAssetDetail,
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
      zoneAssetDetail,
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
          zoneAssetDetail,
          asset.symbol.toLowerCase() + asset_detail_file_name_middle + localization_code + file_extension,
          asset_detail
        );
      
      });
    
    });

  });

};