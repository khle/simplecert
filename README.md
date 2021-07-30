docker build -t khle/simplecert .
docker run -v $PWD/output:/home/data -it khle/simplecert