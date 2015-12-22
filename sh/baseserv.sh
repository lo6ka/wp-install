#!/bin/sh

iptables -F
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -p tcp -m tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp -m tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp -m tcp --dport 443 -j ACCEPT
iptables -A INPUT -p tcp -m tcp --dport 10000 -j ACCEPT
/etc/init.d/iptables save
/etc/init.d/iptables restart

yum -y install perl perl-Net-SSLeay openssl perl-IO-Tty httpd mod_.* php php-mysql php-cli.x86_64 php-common.x86_64 php-gd.x86_64 php-curl.x86_64 mysql mysql-server mysql-devel bind wget nano

# installing webmin
wget http://prdownloads.sourceforge.net/webadmin/webmin-1.770-1.noarch.rpm
rpm -U webmin-1.770-1.noarch.rpm
rm -rf webmin-1.770-1.noarch.rpm
service webmin stop

# installing virtualmin
wget http://software.virtualmin.com/gpl/scripts/install.sh
chmod +x install.sh
printf "y\nlocalhost.localhost.com\n" | ./install.sh
rm -rf install.sh
rm -rf virtualmin-install.log

# installing installatron-plugin
wget https://data.installatron.com/installatron-plugin.sh
chmod +x installatron-plugin.sh
./installatron-plugin.sh -f
rm -rf installatron-plugin.sh

service mysqld restart
service httpd restart
service webmin restart