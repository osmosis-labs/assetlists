// Purpose:
//   to generate the zone_config json using the zone json and chain registry data

//-- Imports --

import * as zone from "./assetlist_functions.mjs";
//import { InLang } from 'inlang';

//-- Functions --

export function localizeAssetDetailAssetlist(chainName) {
  
  let asset_detail_file_name;
  const asset_detail_file_name_middle = "_asset_detail_";
  const file_extension = ".json";
  const default_localization_code = "en";
  const localization_codes = [
    "en",
    "es"
  ];
  let values_to_localize = {};

  let asset_detail_assetlist = zone.readFromFile(
    chainName,
    zone.zoneAssetDetailAssetlist,
    zone.assetlistFileName
  )?.assets;

  let asset_description;
  asset_detail_assetlist.forEach((asset) => {
    if (asset.symbol && asset.description) {
      asset_detail_file_name =
        asset.symbol +
        asset_detail_file_name_middle +
        default_localization_code +
        file_extension;
      values_to_localize.description = asset.description;
      zone.writeToFile(
        chainName,
        zone.zoneAssetDetailLanguageFiles,
        default_localization_code + file_extension,
        values_to_localize
      )
    }
  });

}

export function localizeText(text, localization_code) {
  
  //const inlang = new InLang({
    //languageFilesPath: '../../../osmosis-1/generated/asset_detail/locales',
    //defaultLanguage: 'en', // Default language code
  //});
  
  // Load language files
  inlang.loadLanguageFiles();
  
}

export function extractAssetDetailLocalizationInput(chainName, assets) {

  const file_extension = ".json";
  const default_localization_code = "en";
  let assetSymbolPlaceholder;
  let assetDetailLocalizationList = {};

  assets.forEach((asset) => {
    if (!asset.description || !asset.symbol) {
      return;
    }
    assetSymbolPlaceholder = asset.symbol.replace(/\./g, "(dot)");
    assetDetailLocalizationList[assetSymbolPlaceholder] = {
        description: asset.description
    };
  });

  zone.writeToFile(
    chainName,
    zone.zoneAssetDetailLanguageFiles,
    default_localization_code + file_extension,
    assetDetailLocalizationList
  );

}