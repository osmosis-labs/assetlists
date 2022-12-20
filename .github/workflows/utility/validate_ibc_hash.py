import json
import os
from os import getcwd
import hashlib
import re

rootdir = getcwd()
file = "osmosis-1/osmosis-1.assetlist.json"

mismatches = []

def check():

    # Read file
    print("Reading File: " + "/" + file)
    print(os.path.join(rootdir, file))
    
    # Get JSON Object
    jsonObj = json.load(open(os.path.join(rootdir, file)))
    
    # Declare assets
    assets = jsonObj["assets"]
    
    for asset in assets:
        if "base" not in asset:
            print("Cannot verify " + asset["symbol"] + " -- missing 'base'")
            continue
        if not re.search("^ibc/.*", asset["base"]):
            continue
        if "traces" not in asset:
            print("Cannot verify " + asset["symbol"] + ": " + asset["base"] + " -- missing 'traces'")
            continue
        if len(asset["traces"]) == 0:
            print("Cannot verify " + asset["symbol"] + ": " + asset["base"] + " -- 'traces' length 0")
            continue
            
        trace = asset["traces"][len(asset["traces"])-1]
        type = trace["type"]
        chain = trace["chain"]
        channel = chain["channel_id"]
        if type == "cw20":
            port = chain["port"]
        else:
            port = "transfer"
        if "path" in chain:
            denom = chain["path"]
        else:
            denom = trace["counterparty"]["base_denom"]
        # Generate sha 256 hash
        hash_input = port + "/" + channel + "/" + denom
        hash_output = hashlib.sha256(hash_input.encode('utf-8')).hexdigest()
        ibc_hash = hash_output.upper()
        ibc_hash = "ibc/" + ibc_hash
        # print(ibc_hash)
            
        if asset["base"] != ibc_hash:
            mismatches.append((asset["base"], ibc_hash))
            print(asset["base"])
            print(ibc_hash)
    
    if len(mismatches) > 0:
        print("Incorrect IBC hash(es) found:")
        for mismatch in mismatches:
            print(mismatch)
        raise Exception("Incorrect IBC hash(es) found!")

def run():
    check()
    print("Done")
