To build the image:
```
docker build -t kevinhle/simplecert .
```

To run the image, mount a local directory to the Docker's `/home/data`. For example:
```
docker run -v $PWD/output:/home/data -it kevinhle/simplecert
```