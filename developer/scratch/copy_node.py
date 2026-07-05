import os
import shutil

src = r"C:\Program Files\nodejs\node.exe"
dest_dir = r"d:\nijna data\Project 1 MNQ data\bin"
dest = os.path.join(dest_dir, "node.exe")

try:
    if not os.path.exists(dest_dir):
        os.makedirs(dest_dir)
        print(f"Created directory: {dest_dir}")
    
    print(f"Copying {src} to {dest}...")
    shutil.copy2(src, dest)
    print("Copy complete!")
except Exception as e:
    print(f"Error copying node.exe: {e}")
