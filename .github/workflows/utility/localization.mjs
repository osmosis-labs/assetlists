// Purpose:
//   to generate the zone_config json using the zone json and chain registry data


//-- Imports --

import * as zone from "./assetlist_functions.mjs";
import * as path from 'path';



//-- Globals --

const file_extension = ".json";
const asset_detail_file_name_middle = "_asset_detail_";
const default_localization_code = "en";


//-- Directories --

export const zoneAssetDetail = path.join(zone.generatedDirectoryName, "asset_detail");
export const inlangInputOutput = path.join("languages", "language_files");



//-- Functions --

export function localizeText(text, localization_code) {
  
  //const inlang = new InLang({
    //languageFilesPath: '../../../osmosis-1/generated/asset_detail/locales',
    //defaultLanguage: 'en', // Default language code
  //});
  
  // Load language files
  inlang.loadLanguageFiles();
  
}

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

    try {
      currentDescription = zone.readFromFile(
        chainName,
        zoneAssetDetail,
        asset.symbol + asset_detail_file_name_middle + default_localization_code + file_extension
      )?.description;
    } catch {
      currentDescription = null;
    }
    if (currentDescription === asset.description) { return; }

    inlangInput[chainName][assetSymbolPlaceholder] = {
        description: asset.description
    };

  });
zoneAssetDetailAssetlist
  zone.writeToFile(
    zone.noDir,
    inlangInputOutput,
    default_localization_code + file_extension,
    inlangInput
  );

}

export function getLocalizationOutput() {
  
  let inlangOutput = {};

  const directory = path.join(zone.assetlistsRoot, inlangInputOutput);
  const filesInDirectory = zone.getFilesInDirectory(directory) || [];
  const localization_codes = filesInDirectory.map(file => path.basename(file, path.extname(file))) || [];

  localization_codes.forEach((localization_code) => {
  
    inlangOutput[localization_code] = zone.readFromFile(
      zone.assetlistsRoot,
      inlangInputOutput,
      localization_code + file_extension
    ) || {};

    //extract relevant data from localizations
    getLocalizedDescriptions(inlangOutput[localization_code], localization_code);

  });

}

export function getLocalizedDescriptions(inlangOutput, localization_code) {

  const directory = path.join(zone.assetlistsRoot, inlangInputOutput);
  const filesInDirectory = zone.getFilesInDirectory(directory) || [];
  const localization_codes = filesInDirectory.map(file => path.basename(file, path.extname(file))) || [];

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
      asset_detail.symbol = asset_symbol;

      //write Asset Detail
      zone.writeToFile(
        chainName,
        zoneAssetDetail,
        asset_detail.symbol + asset_detail_file_name_middle + localization_code + file_extension,
        asset_detail
      );
    });
    
  });

}