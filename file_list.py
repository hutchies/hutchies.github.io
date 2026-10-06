import sys
import re
from os import listdir, mkdir, rename
from os.path import isfile, join, exists

path = sys.argv[1]
joiner = ' '

onlyfiles = [f for f in listdir(path) if isfile(join(path, f))]

for file in onlyfiles:
    result = re.match('^([^_]+)_', file)
    folder = ''
    if(result):
        folder = joiner.join(map(str.capitalize, result.group(1).split()))
    if not (exists(path + '/' + folder)):
        mkdir(path + '/' + folder)
    rename(path+'/'+file, path+'/'+folder+'/'+file)
