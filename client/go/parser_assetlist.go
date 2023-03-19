package assetlist

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"strings"
)

func ReadAssetListUnmarshal(relativePathAssetlist string) Root {
	// Read the content of the JSON file using ioutil.ReadFile().
	file, err := ioutil.ReadFile(relativePathAssetlist)
	if err != nil {
		panic(err)
	}

	// Decode the JSON content using json.Unmarshal() and store it in a variable of type AssetList.
	var assetList Root
	err = json.Unmarshal(file, &assetList)
	if err != nil {
		panic(err)
	}
	return assetList
}

func (assetList *Root) GetDenomBySymbol(symbol string) (string, error) {
	symbol = strings.ToUpper(symbol)
	for _, asset := range assetList.Assets {
		if strings.ToUpper(asset.Symbol) == symbol {
			return asset.Base, nil
		}
	}
	return "", fmt.Errorf("No denom found for symbol %s", symbol)
}

func (assetList *Root) GetSymbolByDenom(denom string) (string, error) {
	denom = strings.ToLower(denom)
	for _, asset := range assetList.Assets {
		if strings.ToLower(asset.Base) == denom {
			return asset.Symbol, nil
		}
	}
	return "", fmt.Errorf("No symbol found for denom %s", denom)
}

func (assetList *Root) GetExponentBySymbol(symbol string) (int64, error) {
	symbol = strings.ToUpper(symbol)

	for _, asset := range assetList.Assets {
		// If the symbol of the asset matches the given symbol, look for the corresponding exponent.
		if strings.ToUpper(asset.Symbol) == symbol {
			display := strings.ToLower(asset.Display)

			// Loop through the denom units of the asset to find the corresponding exponent.
			for _, denomUnit := range asset.DenomUnits {
				if strings.ToLower(denomUnit.Denom) == display {
					return denomUnit.Exponent, nil
				}
				if denomUnit.Aliases != nil {
					for _, alias := range denomUnit.Aliases {
						if strings.ToLower(alias) == display {
							return denomUnit.Exponent, nil
						}
					}
				}
			}
		}
	}

	return -1, fmt.Errorf("No exponent found for symbol %s", symbol)
}

func (assetList *Root) GetDenomExponentBySymbol(symbol string) (int64, string, error) {
	symbol = strings.ToUpper(symbol)

	for _, asset := range assetList.Assets {
		// If the symbol of the asset matches the given symbol, look for the corresponding exponent.
		if strings.ToUpper(asset.Symbol) == symbol {
			denom := asset.Base
			display := strings.ToLower(asset.Display)

			// Loop through the denom units of the asset to find the corresponding exponent.
			for _, denomUnit := range asset.DenomUnits {
				if strings.ToLower(denomUnit.Denom) == display {
					return denomUnit.Exponent, denom, nil
				}
				if denomUnit.Aliases != nil {
					for _, alias := range denomUnit.Aliases {
						if strings.ToLower(alias) == display {
							return denomUnit.Exponent, denom, nil
						}
					}
				}
			}
		}
	}

	return -1, "", fmt.Errorf("No exponent and denom found for symbol %s", symbol)
}

func (assetList *Root) GetNameBySymbol(symbol string) (string, error) {
	symbol = strings.ToUpper(symbol)
	for _, asset := range assetList.Assets {
		if strings.ToUpper(asset.Symbol) == symbol {
			return asset.Name, nil
		}
	}
	return "", fmt.Errorf("No name found for symbol %s", symbol)
}
