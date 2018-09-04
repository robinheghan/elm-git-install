# elm-git-install

This is an extension to the Elm platform that allows installing packages from any git url. The git repository will be cloned into the `elm-stuff` folder, the specified tag or sha will be checked out, and the path to the package's source directory will be added to the top-level elm.json file.

This tool will not let you install packages containing ports, kernel or debug code. It does help you installing packages that you, for some reason or other, do not want to publish to Elm's public package repository.

## How to use

Add an object called "git-dependencies" to your `elm.json` file, containing a mapping of git url => tag or sha. Running the program will then download the correct version from git and add the project to the `source-directories` entry in your elm.json file.

Look into the `example` folder for more information.

## WIP

This package is a work in progress. There's a bunch of stuff not added yet, like dependency propogation and error handling. Use at your own risk.
