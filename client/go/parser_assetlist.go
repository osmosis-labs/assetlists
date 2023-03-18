package assetlist

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"path/filepath"
	"strings"
)

var osmosisAssetList Root

func init() {
	// Read the content of the JSON file using ioutil.ReadFile().
	relativePathAssetlist := filepath.Join("..", "..", "osmosis-1", "osmosis-1.assetlist.json")
	file, err := ioutil.ReadFile(relativePathAssetlist)
	if err != nil {
		panic(err)
	}

	// Decode the JSON content using json.Unmarshal() and store it in a variable of type AssetList.
	err = json.Unmarshal(file, &osmosisAssetList)
	if err != nil {
		panic(err)
	}
}

func GetDenomBySymbol(symbol string) (string, error) {
	symbol = strings.ToUpper(symbol)
	for _, asset := range osmosisAssetList.Assets {
		if strings.ToUpper(asset.Symbol) == symbol {
			return asset.Base, nil
		}
	}
	return "", fmt.Errorf("No asset found for symbol %s", symbol)
}

func GetSymbolByDenom(denom string) (string, error) {
	denom = strings.ToLower(denom)
	for _, asset := range osmosisAssetList.Assets {
		if strings.ToLower(asset.Base) == denom {
			return asset.Symbol, nil
		}
	}
	return "", fmt.Errorf("No asset found for denom %s", denom)
}

func GetExponentBySymbol(symbol string) (int64, error) {
	symbol = strings.ToUpper(symbol)

	for _, asset := range osmosisAssetList.Assets {
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

func GetDenomExponentBySymbol(symbol string) (int64, string, error) {
	symbol = strings.ToUpper(symbol)

	for _, asset := range osmosisAssetList.Assets {
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
