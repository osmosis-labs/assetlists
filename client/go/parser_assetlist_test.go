package assetlist

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

var assetList Root

func TestReadAssetListUnmarshalTestnet(t *testing.T) {
	relativePathAssetlist := filepath.Join("..", "..", "osmo-test-4", "osmo-test-4.assetlist.json")
	var assetListTestnet Root
	assetListTestnet = ReadAssetListUnmarshal(relativePathAssetlist)
	require.Equal(t, "osmosistestnet", assetListTestnet.ChainName)
}

func TestReadAssetListUnmarshalMain(t *testing.T) {
	relativePathAssetlist := filepath.Join("..", "..", "osmosis-1", "osmosis-1.assetlist.json")

	assetList = ReadAssetListUnmarshal(relativePathAssetlist)
	require.Equal(t, "osmosis", assetList.ChainName)
}

func TestGetDenomBySymbol(t *testing.T) {
	type testcase struct {
		Symbol        string
		ExpectedDenom string
	}
	testcases := []testcase{
		{"OSMO", "uosmo"},
		{"ATOM", "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"},
	}
	for _, tc := range testcases {
		denom, err := assetList.GetDenomBySymbol(tc.Symbol)
		if err != nil {
			panic(err)
		}
		if denom != tc.ExpectedDenom {
			t.Errorf("Expected %s, got %s", tc.ExpectedDenom, denom)
		}
	}
}

func TestGetSymbolByDenom(t *testing.T) {
	type testcase struct {
		Denom          string
		ExpectedSymbol string
	}
	testcases := []testcase{
		{"uosmo", "OSMO"},
		{"ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", "ATOM"},
	}
	for _, tc := range testcases {
		denom, err := assetList.GetSymbolByDenom(tc.Denom)
		if err != nil {
			panic(err)
		}
		if denom != tc.ExpectedSymbol {
			t.Errorf("Expected %s, got %s", tc.ExpectedSymbol, denom)
		}
	}
}

func TestGetExponentBySymbol(t *testing.T) {
	type testcase struct {
		Symbol           string
		ExpectedExponent int64
	}
	testcases := []testcase{
		{"OSMO", 6},
		{"ATOM", 6},
		{"CANTO", 18},
		{"LUNC", 6},
		{"GRAV", 6},
	}
	for _, tc := range testcases {
		exponent, err := assetList.GetExponentBySymbol(tc.Symbol)
		if err != nil {
			panic(err)
		}
		if exponent != tc.ExpectedExponent {
			t.Errorf("Expected %d, got %d", tc.ExpectedExponent, exponent)
		}
	}
}

func TestGetDenomExponentBySymbol(t *testing.T) {
	type testcase struct {
		Symbol           string
		ExpectedDenom    string
		ExpectedExponent int64
	}
	testcases := []testcase{
		{"OSMO", "uosmo", 6},
		{"ATOM", "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", 6},
		{"CANTO", "ibc/47CAF2DB8C016FAC960F33BC492FD8E454593B65CC59D70FA9D9F30424F9C32F", 18},
		{"LUNC", "ibc/0EF15DF2F02480ADE0BB6E85D9EBB5DAEA2836D3860E9F97F9AADE4F57A31AA0", 6},
		{"GRAV", "ibc/E97634A40119F1898989C2A23224ED83FDD0A57EA46B3A094E287288D1672B44", 6},
	}
	for _, tc := range testcases {
		exponent, denom, err := assetList.GetDenomExponentBySymbol(tc.Symbol)
		if err != nil {
			panic(err)
		}
		if denom != tc.ExpectedDenom {
			t.Errorf("Expected %s, got %s", tc.ExpectedDenom, denom)
		}
		if exponent != tc.ExpectedExponent {
			t.Errorf("Expected %d, got %d", tc.ExpectedExponent, exponent)
		}
	}
}

func TestGetNameBySymbol(t *testing.T) {
	type testcase struct {
		Symbol       string
		ExpectedName string
	}
	testcases := []testcase{
		{"OSMO", "Osmosis"},
		{"JUNO", "Juno"},
	}
	for _, tc := range testcases {
		name, err := assetList.GetNameBySymbol(tc.Symbol)
		if err != nil {
			panic(err)
		}
		if name != tc.ExpectedName {
			t.Errorf("Expected %s, got %s", tc.ExpectedName, name)
		}
	}
}
