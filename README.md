# elm-git-install (alpha)

__Note: This tool is meant for businesses who whishes to use their internal packages without exposing them to the world wide web. If you're working on an open-source library, you should use Elm's builtin package manager.__

This tool allows you to install Elm packages using git. Any git remote is supported, and you can specify which commit SHA or git tag (preferably semver formated) you wan't to use. Other than supporting git remotes, the tool aims to mimick the behaviour of Elm's builtin package manger.

## How to use

First, install using `npm`: `npm install elm-git-install`

Then create an `elm-git.json` file in your root directory.

If your project is an Elm application it should look like this:

```
{
    "git-dependencies": {
        "direct": {
            "git@github.com:Skinney/elm-git-example1.git": "1.0.0",
            "git@github.com:Skinney/elm-git-example2.git": "1.0.2"
        },
        "indirect": {
            "git@github.com:Skinney/elm-git-example3.git": "1.0.0"
        }
    }
}
```

The `indirect` object will be filled out automatically any time a new transitive dependency is discovered (meaning you can leave it blank).

If your project is an Elm package, it should look like this:

```
{
  "git-dependencies": {
    "git@github.com:Skinney/elm-git-example3.git": "1.0.0 <= v < 2.0.0"
  }
}
```

For both applications and packages, you can specify a git SHA or tag instead of a semver formated tag.

`elm-git-install` will fail if run in a package context. This is because Elm only supports setting `source-directories` for applications. As noted above though, we do support `elm-git.json` files in packages, so you are able to define transitive dependencies. You'll likely need to create an application for building and testing the package though.

For a practical example, check the `example` folder.

## How does it work

In short, the tool looks up the dependencies in your `elm-git.json` file and clones them into your `elm-stuff` folder, which is likely not in version control. The `src` directory of these repos will then be added to your `elm.json` file under the `source-directories` property so Elm's compiler will see the sources.

If your git dependencies makes use of semver formatted tags, `elm-git-install` will try to make sure that any version ranges specified in your git packages are respected.

## Why can't I specify a git branch?

Branches are, by default, a moving target and shouldn't be relied upon for dependency management. While both SHAs and tags can change in git, they are much more likely to remain static over their lifetime, and so fits better as a target for dependency resolution.

## Work in Progress

`elm-git-install` is currently in alpha. There will be bugs and missing features, and the code is in flux. If you want to participate, then reporting bugs and discussing the already existing issues is the current way to go.
