package assetlist

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestType(t *testing.T) {
	relativePathAssetlist := filepath.Join("..", "..", "osmosis-1", "osmosis-1.assetlist.json")

	content, err := ioutil.ReadFile(relativePathAssetlist) // the file is inside the local directory
	if err != nil {
		fmt.Println("Err")
	}
	var root Root
	err = json.Unmarshal(content, &root)
	require.NoError(t, err)
	require.Equal(t, "osmosis", root.ChainName)
}
